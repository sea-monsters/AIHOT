// Links in the site's own copy (terms, privacy): the site's own address stays on the site, whatever
// domain it is deployed at; any other address opens in a new tab.
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../app/lib/markdown.ts";

const SITE = "https://news.example.com";
const link = (md: string) => /<a [^>]*>/.exec(renderMarkdown(md, SITE).html)?.[0];

test("a link to the site's own address becomes an in-site path", () => {
  assert.equal(link("[关于](https://news.example.com/about)"), '<a href="/about">');
  assert.equal(link("[首页](https://news.example.com)"), '<a href="/">');
  assert.equal(link("[隐私](/privacy)"), '<a href="/privacy">');
});

test("any other address opens in a new tab", () => {
  assert.equal(link("[AIHOT](https://aihot.news/about)"), '<a href="https://aihot.news/about" target="_blank" rel="noopener noreferrer">');
  assert.equal(link("[别的站](https://news.example.com.evil.test/about)"), '<a href="https://news.example.com.evil.test/about" target="_blank" rel="noopener noreferrer">');
});


test("nested and mixed lists preserve real parent-child relationships", () => {
  const html = renderMarkdown("- Parent **label**\n  - Child\n    1. Grandchild\n  - Sibling\n- Second\n1. Ordered peer\n   continuation", SITE).html;
  assert.equal(html, '<ul><li>Parent <strong>label</strong><ul><li>Child<ol><li>Grandchild</li></ol></li><li>Sibling</li></ul></li><li>Second</li></ul>\n<ol><li>Ordered peer continuation</li></ol>');
});

test("lists keep numbering, escaping, section levels and surrounding tables intact", () => {
  const html = renderMarkdown("## Section\n3. Third `code`\n   - <script>\n\n### Subsection\n| Header |\n| --- |\n| Cell |\n\nOrdinary paragraph", SITE).html;
  assert.match(html, /<h2 id="s1">Section<\/h2>/);
  assert.match(html, /<ol start="3"><li>Third <code>code<\/code><ul><li>&lt;script&gt;<\/li><\/ul><\/li><\/ol>/);
  assert.match(html, /<h3 id="s2">Subsection<\/h3>/);
  assert.match(html, /<table><thead><tr><th>Header<\/th>/);
  assert.match(html, /<td>Cell<\/td>/);
  assert.ok(html.endsWith('<p>Ordinary paragraph</p>'));
});
