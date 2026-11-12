const ts = require('typescript'); const fs = require('fs'); const path = require('path');
const keys = new Set();
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'data' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const addExpr = (e) => {
  if (!e) return;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) keys.add(e.text);
  else if (ts.isConditionalExpression(e)) { addExpr(e.whenTrue); addExpr(e.whenFalse); }
  else if (ts.isParenthesizedExpression(e)) addExpr(e.expression);
  else if (ts.isBinaryExpression(e) && ['||', '??'].includes(e.operatorToken.getText())) { addExpr(e.left); addExpr(e.right); }
};
for (const f of walk('src').filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) && !f.includes('/i18n/'))) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const v = (n) => { if (ts.isCallExpression(n) && n.expression.getText(sf) === 'tr') addExpr(n.arguments[0]); ts.forEachChild(n, v); };
  v(sf);
}
fs.writeFileSync('/tmp/x/ui-keys.json', JSON.stringify([...keys].sort(), null, 1));
console.log(keys.size);
