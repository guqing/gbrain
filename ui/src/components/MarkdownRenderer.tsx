import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { nodeText } from "../lib/format";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

type Props = {
  markdown: string;
  onImageClick: (src: string, alt: string) => void;
};

export function MarkdownRenderer({ markdown, onImageClick }: Props) {
  const components = React.useMemo(() => {
    const seen = new Map<string, number>();
    const headingId = (children: React.ReactNode) => {
      const base = slugify(nodeText(children));
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base}-${count + 1}`;
    };
    return {
      h1: ({ children }: { children?: React.ReactNode }) => <h1 id={headingId(children)}>{children}</h1>,
      h2: ({ children }: { children?: React.ReactNode }) => <h2 id={headingId(children)}>{children}</h2>,
      h3: ({ children }: { children?: React.ReactNode }) => <h3 id={headingId(children)}>{children}</h3>,
      img: ({ src, alt }: { src?: string; alt?: string }) =>
        src ? (
          <img
            alt={alt ?? ""}
            className="my-4 max-h-[600px] max-w-full cursor-zoom-in rounded-lg border border-border object-contain shadow-sm"
            src={src}
            onClick={() => onImageClick(src, alt ?? "")}
          />
        ) : null,
    };
  }, [onImageClick]);

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  );
}
