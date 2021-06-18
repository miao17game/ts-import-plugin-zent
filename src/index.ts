import ts from "typescript";

interface ImportedStruct {
  importName: string;
  variableName?: string;
}

function getStylePath(component: string, libName: string, useRaw: boolean) {
  let suffix;
  let parentDir;

  if (useRaw) {
    suffix = ".scss";
    parentDir = "assets";
  } else {
    suffix = ".css";
    parentDir = "css";
  }
  return `${libName}/${parentDir}/${component}${suffix}`;
}

function getModuleMappingFile(libName: string) {
  return `${libName}/dependency-graph.json`;
}

function getJavaScriptPath(relativePath: string, libName: string) {
  const parentDir = "es";
  return `${libName}/${parentDir}${relativePath}`.replace(".js", "");
}

function getImportedStructs(node: ts.Node) {
  const structs = new Set<ImportedStruct>();
  node.forEachChild((importChild) => {
    if (!ts.isImportClause(importChild)) {
      return;
    }
    if (importChild.name || !importChild.namedBindings) {
      return;
    }
    if (!ts.isNamedImports(importChild.namedBindings)) {
      return;
    }
    importChild.namedBindings.forEachChild((namedBinding) => {
      const importSpecifier = <ts.ImportSpecifier>namedBinding;
      if (!importSpecifier.propertyName) {
        structs.add({ importName: importSpecifier.name.text });
        return;
      }
      structs.add({
        importName: importSpecifier.propertyName.text,
        variableName: importSpecifier.name.text,
      });
    });
  });
  return structs;
}

interface IMapItem {
  js: string;
  isDefaultExport: boolean;
  style: string[];
}

function createDistAst(
  struct: ImportedStruct,
  options: {
    libraryName: "zent";
    libraryDirectory: "es";
    css: Record<string, boolean>;
  }
) {
  const astNodes: ts.Node[] = [];
  const { libraryName } = options;
  let MODULE_MAPPING: Record<string, IMapItem>;
  try {
    // eslint-disable-next-line
    MODULE_MAPPING = require(getModuleMappingFile(libraryName));
  } catch (ex) {
    throw new Error("get zent module mapping file failed.");
  }
  const rule = MODULE_MAPPING[struct.importName];
  if (!rule) return [];
  const importPath = getJavaScriptPath(rule.js, libraryName);
  const scriptNode = ts.createImportDeclaration(
    undefined,
    undefined,
    ts.createImportClause(
      !rule.isDefaultExport
        ? undefined
        : ts.createIdentifier(struct.variableName || struct.importName),
      !rule.isDefaultExport
        ? ts.createNamedImports([
            ts.createImportSpecifier(
              !struct.variableName
                ? void 0
                : ts.createIdentifier(struct.importName),
              !struct.variableName
                ? ts.createIdentifier(struct.importName)
                : ts.createIdentifier(struct.variableName)
            ),
          ])
        : undefined
    ),
    ts.createLiteral(importPath)
  );
  astNodes.push(scriptNode);
  const { css } = options;
  rule.style.forEach((path) => {
    if (css[path] === void 0) {
      astNodes.push(
        ts.createImportDeclaration(
          undefined,
          undefined,
          undefined,
          ts.createLiteral(getStylePath(path, libraryName, true))
        )
      );
      css[path] = true;
    }
  });
  return astNodes;
}

export default function createTransformer(packageName: string = "zent") {
  return (context: ts.TransformationContext) => {
    const visitor: ts.Visitor = (node) => {
      if (ts.isSourceFile(node)) {
        return ts.visitEachChild(node, visitor, context);
      }
      if (!ts.isImportDeclaration(node)) {
        return node;
      }
      const importedLibName =
        ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text;
      if (importedLibName !== packageName) {
        return node;
      }
      const structs = getImportedStructs(node);
      if (structs.size === 0) {
        return node;
      }
      const css: Record<string, boolean> = {};
      return Array.from(structs).reduce((acc, struct) => {
        const nodes = createDistAst(struct, {
          libraryName: <"zent">packageName,
          libraryDirectory: "es",
          css,
        });
        return acc.concat(nodes);
      }, <ts.Node[]>[]);
    };
    return (node: ts.Node) => ts.visitNode(node, visitor);
  };
}
