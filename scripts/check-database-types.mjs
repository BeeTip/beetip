import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const generatedPath = process.argv[2];
assert(generatedPath, "Pass the TypeScript output from supabase gen types --local --schema public");

function publicSchema(path) {
  const file = ts.createSourceFile("database.types.ts", readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  assert.equal(file.parseDiagnostics.length, 0, "Database types must parse as TypeScript");
  const database = file.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === "Database");
  assert(database && ts.isTypeLiteralNode(database.type), "Missing Database type");
  const schema = database.type.members.find(node => node.name?.getText(file) === "public");
  assert(schema?.type && ts.isTypeLiteralNode(schema.type), "Missing Database.public type");
  return schema.type;
}

function typeShape(node) {
  if (ts.isTypeLiteralNode(node)) {
    // A schema object has no declaration order. Tuples and overloads retain theirs.
    const members = node.members.map(typeShape);
    if (node.members.every(ts.isPropertySignature)) members.sort();
    return [node.kind, members];
  }
  const children = node.getChildren().filter(child =>
    child.kind !== ts.SyntaxKind.SemicolonToken && child.kind !== ts.SyntaxKind.CommaToken);
  return [node.kind, children.length ? children.map(typeShape) : node.getText()];
}

const checkedIn = publicSchema(new URL("../packages/database/src/database.types.ts", import.meta.url));
const generated = publicSchema(generatedPath);
const sections = schema => new Map(schema.members.map(node => [node.name.getText(), JSON.stringify(typeShape(node))]));
const expected = sections(generated);
const actual = sections(checkedIn);
const differences = [...new Set([...expected.keys(), ...actual.keys()])]
  .filter(section => expected.get(section) !== actual.get(section));
assert.equal(differences.length, 0, `Generated public schema type drift in ${differences.join(", ")}`);
console.log("PASS checked-in public schema types match the fresh database");
