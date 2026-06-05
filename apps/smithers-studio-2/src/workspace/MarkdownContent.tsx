import { Fragment, type ReactNode } from "react";

/**
 * Only render links whose scheme can't execute script. Agent/LLM output can
 * contain `[label](javascript:...)`, which React renders verbatim into href and
 * runs on click. Allow http(s), mailto, and relative/anchor links; everything
 * else falls back to plain text.
 */
function isSafeHref(href: string): boolean {
  const value = href.trim();
  if (value.startsWith("/") || value.startsWith("#") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  return /^(https?:|mailto:)/i.test(value);
}

/**
 * Dependency-free markdown renderer for chat blocks. The repo ships no markdown
 * library, and chat content is trusted agent output (not arbitrary HTML), so we
 * render a deliberately small, safe subset: fenced code blocks, inline code,
 * bold, italic, links, and paragraph/line breaks. Code is rendered verbatim in
 * a mono block (no HTML injection) — exactly the surface the gui POC
 * ChatBlockRenderer covers.
 */
export function MarkdownContent({ text }: { text: string }) {
  const segments = splitFences(text);
  return (
    <div className="ws-md">
      {segments.map((segment, index) =>
        segment.kind === "code" ? (
          <pre className="ws-md-code" data-lang={segment.lang || undefined} key={index}>
            <code>{segment.text}</code>
          </pre>
        ) : (
          <Fragment key={index}>{renderProse(segment.text)}</Fragment>
        ),
      )}
    </div>
  );
}

type Segment = { kind: "code"; text: string; lang: string } | { kind: "prose"; text: string };

function splitFences(text: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "prose", text: text.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "code", lang: match[1].trim(), text: match[2].replace(/\n$/, "") });
    lastIndex = fence.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "prose", text: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ kind: "prose", text }];
}

function renderProse(text: string): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {renderInline(line)}
    </Fragment>
  ));
}

/**
 * Inline pass: `code`, ***bold-italic***, **bold**, *italic*, and [label](url)
 * links.
 *
 * Scans left-to-right and, at each position, tries the earliest token. Each
 * branch is anchored at the cursor (`^`) so a literal `*` inside ordinary prose
 * never starts a phantom emphasis run. The `***triple***` rule runs before bold
 * so the bold rule can't swallow the leading `**` and strand the third `*`.
 * Bold/italic spans accept ANY inner
 * character (including other delimiters) and the inner text is rendered
 * RECURSIVELY, so nested (`**bold *and italic* back**`) and adjacent
 * (`*a**b**c*`) tokens tokenize correctly instead of the old `[^*]+` runs that
 * bailed at the first inner `*`. Code spans are matched first and rendered
 * verbatim — never recursed — so backticked text can't smuggle markup.
 */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let pending = "";
  let key = 0;

  const flushPending = () => {
    if (pending) {
      nodes.push(pending);
      pending = "";
    }
  };

  while (rest.length > 0) {
    // Code span: literal, highest precedence, no recursion into its body.
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      flushPending();
      nodes.push(
        <code className="ws-md-inline-code" key={key++}>
          {code[1]}
        </code>,
      );
      rest = rest.slice(code[0].length);
      continue;
    }

    // Link: [label](href). Label is rendered recursively; unsafe schemes degrade
    // to the plain label text (XSS mitigation preserved).
    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (link) {
      flushPending();
      const [, label, href] = link;
      if (isSafeHref(href)) {
        nodes.push(
          <a className="ws-md-link" href={href} key={key++} rel="noreferrer" target="_blank">
            {renderInline(label)}
          </a>,
        );
      } else {
        nodes.push(<Fragment key={key++}>{renderInline(label)}</Fragment>);
      }
      rest = rest.slice(link[0].length);
      continue;
    }

    // Bold+italic (`***text***`) before bold/italic, else the bold rule eats the
    // leading `**` and strands the third `*` (rendering `***x***` as a broken
    // `<strong>*x</strong>*`). Rendered as em-wrapped strong, body recursed.
    const boldItalic = /^\*\*\*([\s\S]+?)\*\*\*/.exec(rest);
    if (boldItalic) {
      flushPending();
      nodes.push(
        <em key={key++}>
          <strong>{renderInline(boldItalic[1])}</strong>
        </em>,
      );
      rest = rest.slice(boldItalic[0].length);
      continue;
    }

    // Bold before italic so `**` is not mis-read as two italic markers. Inner
    // content is non-greedy and may contain any char, then is rendered
    // recursively for nesting.
    const bold = /^\*\*([\s\S]+?)\*\*/.exec(rest);
    if (bold) {
      flushPending();
      nodes.push(<strong key={key++}>{renderInline(bold[1])}</strong>);
      rest = rest.slice(bold[0].length);
      continue;
    }

    // Italic content may embed whole `**bold**` chunks, so its body is a run of
    // either a balanced bold pair or a non-`*` char; the trailing single `*`
    // closes it. (Bold is tried above, so `rest` here never opens with `**`.)
    const italic = /^\*((?:\*\*[\s\S]*?\*\*|[^*])+)\*/.exec(rest);
    if (italic) {
      flushPending();
      nodes.push(<em key={key++}>{renderInline(italic[1])}</em>);
      rest = rest.slice(italic[0].length);
      continue;
    }

    // No token at the cursor: consume one char into the pending text buffer.
    pending += rest[0];
    rest = rest.slice(1);
  }

  flushPending();
  return nodes;
}
