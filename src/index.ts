import type { Application } from "typedoc";
import {
  Comment,
  CommentTag,
  DeclarationReflection,
  ParameterReflection,
  ReflectionFlag,
  ReflectionKind,
  SignatureReflection,
} from "typedoc";

// ─── TypeScript type helpers ─────────────────────────────────────────────────

type TSChecker = import("typescript").TypeChecker;
type TSType = import("typescript").Type;
type TSSymbol = import("typescript").Symbol;
type TSNode = import("typescript").Node;
type TSClassDeclaration = import("typescript").ClassDeclaration;

// ─── Event map resolution ────────────────────────────────────────────────────

/**
 * Walk the heritage clauses of a class and return the type argument passed to
 * `EventEmitter<T>`, or `undefined` if the class doesn't extend EventEmitter.
 */
function resolveEventMapType(checker: TSChecker, classDecl: TSClassDeclaration): TSType | undefined {
  const heritage = classDecl.heritageClauses;
  if (!heritage) return undefined;

  for (const clause of heritage) {
    for (const expr of clause.types as any[]) {
      const sym: TSSymbol | undefined = checker.getTypeAtLocation(expr.expression).getSymbol();
      if (!sym || sym.getName() !== "EventEmitter") continue;

      const typeArgs: any[] | undefined = expr.typeArguments;
      if (!typeArgs || typeArgs.length === 0) return undefined;

      return checker.getTypeAtLocation(typeArgs[0]);
    }
  }
  return undefined;
}

// ─── Parameter extraction ────────────────────────────────────────────────────

interface EventParam {
  name: string;
  typeStr: string;
  optional: boolean;
}

/**
 * Extract named parameters from a tuple type, e.g. `[queue: Queue, track: Track]`.
 * Falls back to `arg0`, `arg1`, … when labels are absent.
 */
function extractTupleParams(checker: TSChecker, tupleType: TSType): EventParam[] {
  const params: EventParam[] = [];

  // Resolve the tuple type node for named labels
  const sym: TSSymbol | undefined = (tupleType as any).aliasSymbol ?? (tupleType as any).symbol;
  const typeNode: any = sym?.declarations?.[0];

  const typeArgs: TSType[] | undefined = checker.getTypeArguments(tupleType as any);

  if (typeArgs && typeArgs.length > 0) {
    for (let i = 0; i < typeArgs.length; i++) {
      const elemType = typeArgs[i]!;
      const elem: any = typeNode?.elements?.[i];
      params.push({
        name: elem?.name?.text ?? `arg${i}`,
        typeStr: checker.typeToString(elemType),
        optional: !!elem?.dotDotDotToken || !!elem?.questionToken,
      });
    }
    return params;
  }

  // Fallback: iterate tuple properties
  for (const prop of tupleType.getProperties()) {
    const propDecl: TSNode | undefined = prop.getDeclarations()?.[0];
    if (!propDecl) continue;
    const propType = checker.getTypeOfSymbolAtLocation(prop, propDecl);
    params.push({
      name: prop.getName(),
      typeStr: checker.typeToString(propType),
      optional: !!(prop.flags & 16777216 /* Optional */),
    });
  }

  return params;
}

// ─── JSDoc extraction ────────────────────────────────────────────────────────

/**
 * Read the JSDoc comment for a single event property from the event map type.
 * Reads the plain description and `@remarks` tag.
 */
function getEventJsDoc(mapType: TSType, eventName: string): {
  summary: string | undefined;
  remarks: string | undefined;
  deprecated: string | undefined;
  since: string | undefined;
} {
  const prop: TSSymbol | undefined = mapType.getProperty(eventName);
  const result = { summary: undefined as string | undefined, remarks: undefined as string | undefined, deprecated: undefined as string | undefined, since: undefined as string | undefined };

  if (!prop) return result;

  // Read JSDoc tags (remarks, deprecated, since)
  const tags: { name: string; text?: { text: string }[] }[] | undefined = (prop as any).getJsDocTags?.();
  if (tags) {
    for (const tag of tags) {
      const text = tag.text?.map((p) => p.text).join("") ?? "";
      if (tag.name === "remarks") result.remarks = text;
      if (tag.name === "deprecated") result.deprecated = text || "true";
      if (tag.name === "since") result.since = text;
    }
  }

  // Read plain description from the declaration's JSDoc comment
  const decls = prop.getDeclarations();
  if (decls && decls.length > 0) {
    const decl = decls[0] as any;
    const comment = decl.jsDoc?.[0]?.comment;
    if (typeof comment === "string") result.summary = comment;
    // TypeScript 5+ stores comment as array of parts
    else if (Array.isArray(comment)) {
      result.summary = comment.map((p: any) => (typeof p === "string" ? p : p.text ?? "")).join("");
    }
  }

  return result;
}

// ─── Reflection injection ────────────────────────────────────────────────────

/**
 * Build a proper TypeDoc `Method` reflection for a single event, with a real
 * `CallSignature` child and typed parameters — identical in structure to how
 * TypeDoc renders any other method on the class.
 */
function injectEventMethod(
  classReflection: DeclarationReflection,
  checker: TSChecker,
  mapType: TSType,
  eventName: string,
  params: EventParam[],
): void {
  // ── method declaration ──────────────────────────────────────────────────
  const method = new DeclarationReflection(eventName, ReflectionKind.Method, classReflection);
  method.setFlag(ReflectionFlag.Public, true);

  const jsDoc = getEventJsDoc(mapType, eventName);

  const summaryText = jsDoc.summary ?? `Emitted when the \`${eventName}\` event fires.`;
  const summary: Comment["summary"] = [{ kind: "text", text: summaryText }];

  method.comment = new Comment(summary);

  // @group Events — groups all events together in the sidebar/page
  method.comment.blockTags.push(new CommentTag("@group" as any, [{ kind: "text", text: "Events" }]));

  // @event tag — marks this as an event for renderers that support it
  method.comment.blockTags.push(new CommentTag("@event" as any, [{ kind: "text", text: eventName }]));

  // @remarks
  if (jsDoc.remarks) {
    method.comment.blockTags.push(new CommentTag("@remarks" as any, [{ kind: "text", text: jsDoc.remarks }]));
  }

  // @deprecated
  if (jsDoc.deprecated) {
    method.comment.blockTags.push(new CommentTag("@deprecated" as any, [{ kind: "text", text: jsDoc.deprecated }]));
  }

  // @since
  if (jsDoc.since) {
    method.comment.blockTags.push(new CommentTag("@since" as any, [{ kind: "text", text: jsDoc.since }]));
  }

  // ── call signature ──────────────────────────────────────────────────────
  const sig = new SignatureReflection(eventName, ReflectionKind.CallSignature, method);
  sig.comment = new Comment([{ kind: "text", text: summaryText }]);

  // Build parameter reflections
  sig.parameters = params.map((p) => {
    const param = new ParameterReflection(p.name, ReflectionKind.Parameter, sig);
    param.setFlag(ReflectionFlag.Optional, p.optional);

    // Use an intrinsic type so it renders exactly like a real type reference
    param.type = { type: "intrinsic", name: p.typeStr } as any;

    // @param tag on the signature comment
    sig.comment!.blockTags.push(
      new CommentTag("@param" as any, [{ kind: "text", text: p.typeStr }]),
    );

    return param;
  });

  // Return type: void (event listeners return nothing)
  sig.type = { type: "intrinsic", name: "void" } as any;

  method.signatures = [sig];

  // ── attach to class ─────────────────────────────────────────────────────
  classReflection.children ??= [];
  classReflection.children.push(method);
}

// ─── Plugin entry point ──────────────────────────────────────────────────────

export function load(app: Application): void {
  app.converter.on(
    "createDeclaration" as any,
    (context: any, reflection: DeclarationReflection) => {
      if (reflection.kind !== ReflectionKind.Class) return;

      // Get the TypeScript symbol backing this reflection
      const symbol: TSSymbol | undefined = context.getSymbolFromReflection(reflection);
      if (!symbol) return;

      const decls = symbol.getDeclarations();
      if (!decls || decls.length === 0) return;

      const checker: TSChecker = context.checker;

      for (const decl of decls) {
        const classDecl = decl as unknown as TSClassDeclaration;
        if (!classDecl.heritageClauses) continue;

        const mapType = resolveEventMapType(checker, classDecl);
        if (!mapType) continue;

        // Extract all event entries from the map type
        for (const prop of mapType.getProperties()) {
          const eventName = prop.getName();
          const propDecls = prop.getDeclarations();
          if (!propDecls || propDecls.length === 0) continue;

          const propType = checker.getTypeOfSymbolAtLocation(prop, propDecls[0]!);
          const params = extractTupleParams(checker, propType);

          injectEventMethod(reflection, checker, mapType, eventName, params);
        }

        break; // only process the first matching heritage clause
      }
    },
  );
}
