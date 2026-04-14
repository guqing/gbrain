import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkHeadingIds } from "../lib/remark";

type Props = {
  markdown: string;
  onImageClick: (src: string, alt: string) => void;
};

export function MarkdownRenderer({ markdown, onImageClick }: Props) {
  const components = React.useMemo(
    () => ({
      img: ({ src, alt }: { src?: string; alt?: string }) =>
        src ? (
          <img
            alt={alt ?? ""}
            className="my-4 max-h-[600px] max-w-full cursor-zoom-in rounded-lg border border-border object-contain shadow-sm"
            src={src}
            onClick={() => onImageClick(src, alt ?? "")}
          />
        ) : null,
    }),
    [onImageClick]
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkHeadingIds]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
}
