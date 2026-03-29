import { describe, expect, test } from "bun:test";
import { createPlaygroundIndexHtml } from "../playground/build";

describe("playground site build", () => {
  test("generated html references relative static assets", () => {
    const html = createPlaygroundIndexHtml();
    expect(html).toContain('./styles.css');
    expect(html).toContain('./assets/main.js');
  });
});
