import { Comment, CommentTag, DeclarationReflection, ParameterReflection, ReflectionFlag, ReflectionKind, SignatureReflection } from "typedoc";
//#region src/index.ts
/**
* Walk the heritage clauses of a class and return the type argument passed to
* `EventEmitter<T>`, or `undefined` if the class doesn't extend EventEmitter.
*/
function resolveEventMapType(checker, classDecl) {
	const heritage = classDecl.heritageClauses;
	if (!heritage) return void 0;
	for (const clause of heritage) for (const expr of clause.types) {
		const sym = checker.getTypeAtLocation(expr.expression).getSymbol();
		if (!sym || sym.getName() !== "EventEmitter") continue;
		const typeArgs = expr.typeArguments;
		if (!typeArgs || typeArgs.length === 0) return void 0;
		return checker.getTypeAtLocation(typeArgs[0]);
	}
}
/**
* Extract named parameters from a tuple type, e.g. `[queue: Queue, track: Track]`.
* Falls back to `arg0`, `arg1`, … when labels are absent.
*/
function extractTupleParams(checker, tupleType) {
	const params = [];
	const typeNode = (tupleType.aliasSymbol ?? tupleType.symbol)?.declarations?.[0];
	const typeArgs = checker.getTypeArguments(tupleType);
	if (typeArgs && typeArgs.length > 0) {
		for (let i = 0; i < typeArgs.length; i++) {
			const elemType = typeArgs[i];
			const elem = typeNode?.elements?.[i];
			params.push({
				name: elem?.name?.text ?? `arg${i}`,
				typeStr: checker.typeToString(elemType),
				optional: !!elem?.dotDotDotToken || !!elem?.questionToken
			});
		}
		return params;
	}
	for (const prop of tupleType.getProperties()) {
		const propDecl = prop.getDeclarations()?.[0];
		if (!propDecl) continue;
		const propType = checker.getTypeOfSymbolAtLocation(prop, propDecl);
		params.push({
			name: prop.getName(),
			typeStr: checker.typeToString(propType),
			optional: !!(prop.flags & 16777216)
		});
	}
	return params;
}
/**
* Read the JSDoc comment for a single event property from the event map type.
* Reads the plain description and `@remarks` tag.
*/
function getEventJsDoc(mapType, eventName) {
	const prop = mapType.getProperty(eventName);
	const result = {
		summary: void 0,
		remarks: void 0,
		deprecated: void 0,
		since: void 0
	};
	if (!prop) return result;
	const tags = prop.getJsDocTags?.();
	if (tags) for (const tag of tags) {
		const text = tag.text?.map((p) => p.text).join("") ?? "";
		if (tag.name === "remarks") result.remarks = text;
		if (tag.name === "deprecated") result.deprecated = text || "true";
		if (tag.name === "since") result.since = text;
	}
	const decls = prop.getDeclarations();
	if (decls && decls.length > 0) {
		const comment = decls[0].jsDoc?.[0]?.comment;
		if (typeof comment === "string") result.summary = comment;
		else if (Array.isArray(comment)) result.summary = comment.map((p) => typeof p === "string" ? p : p.text ?? "").join("");
	}
	return result;
}
/**
* Build a proper TypeDoc `Method` reflection for a single event, with a real
* `CallSignature` child and typed parameters — identical in structure to how
* TypeDoc renders any other method on the class.
*/
function injectEventMethod(classReflection, checker, mapType, eventName, params) {
	const method = new DeclarationReflection(eventName, ReflectionKind.Method, classReflection);
	method.setFlag(ReflectionFlag.Public, true);
	const jsDoc = getEventJsDoc(mapType, eventName);
	const summaryText = jsDoc.summary ?? `Emitted when the \`${eventName}\` event fires.`;
	method.comment = new Comment([{
		kind: "text",
		text: summaryText
	}]);
	method.comment.blockTags.push(new CommentTag("@group", [{
		kind: "text",
		text: "Events"
	}]));
	method.comment.blockTags.push(new CommentTag("@event", [{
		kind: "text",
		text: eventName
	}]));
	if (jsDoc.remarks) method.comment.blockTags.push(new CommentTag("@remarks", [{
		kind: "text",
		text: jsDoc.remarks
	}]));
	if (jsDoc.deprecated) method.comment.blockTags.push(new CommentTag("@deprecated", [{
		kind: "text",
		text: jsDoc.deprecated
	}]));
	if (jsDoc.since) method.comment.blockTags.push(new CommentTag("@since", [{
		kind: "text",
		text: jsDoc.since
	}]));
	const sig = new SignatureReflection(eventName, ReflectionKind.CallSignature, method);
	sig.comment = new Comment([{
		kind: "text",
		text: summaryText
	}]);
	sig.parameters = params.map((p) => {
		const param = new ParameterReflection(p.name, ReflectionKind.Parameter, sig);
		param.setFlag(ReflectionFlag.Optional, p.optional);
		param.type = {
			type: "intrinsic",
			name: p.typeStr
		};
		sig.comment.blockTags.push(new CommentTag("@param", [{
			kind: "text",
			text: p.typeStr
		}]));
		return param;
	});
	sig.type = {
		type: "intrinsic",
		name: "void"
	};
	method.signatures = [sig];
	classReflection.children ??= [];
	classReflection.children.push(method);
}
function load(app) {
	app.converter.on("createDeclaration", (context, reflection) => {
		if (reflection.kind !== ReflectionKind.Class) return;
		const symbol = context.getSymbolFromReflection(reflection);
		if (!symbol) return;
		const decls = symbol.getDeclarations();
		if (!decls || decls.length === 0) return;
		const checker = context.checker;
		for (const decl of decls) {
			const classDecl = decl;
			if (!classDecl.heritageClauses) continue;
			const mapType = resolveEventMapType(checker, classDecl);
			if (!mapType) continue;
			for (const prop of mapType.getProperties()) {
				const eventName = prop.getName();
				const propDecls = prop.getDeclarations();
				if (!propDecls || propDecls.length === 0) continue;
				injectEventMethod(reflection, checker, mapType, eventName, extractTupleParams(checker, checker.getTypeOfSymbolAtLocation(prop, propDecls[0])));
			}
			break;
		}
	});
}
//#endregion
export { load };
