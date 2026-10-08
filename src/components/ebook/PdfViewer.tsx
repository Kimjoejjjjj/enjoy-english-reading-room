// src/components/ebook/PdfViewer.tsx
"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { BookOpen, BookOpenCheck, ChevronLeft, ChevronRight } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/build/pdf.worker.min.mjs";

interface PdfViewerProps {
  url: string;
  currentPage: number;
  totalPages: number;
  onPageChange?: (page: number) => void;
  onTextSelected?: (text: string) => void;
}

type SpreadMode = "single" | "double";

export default function PdfViewer({
  url,
  currentPage,
  totalPages,
  onPageChange,
  onTextSelected,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [spreadMode, setSpreadMode] = useState<SpreadMode>("single");

  // Inject text-layer CSS once — makes the layer transparent but selectable
  useEffect(() => {
    const id = "pdf-text-layer-css";
    if (!document.getElementById(id)) {
      const s = document.createElement("style");
      s.id = id;
      s.textContent = ".pdf-text-layer{opacity:0!important;pointer-events:auto!important}";
      document.head.appendChild(s);
    }
  }, []);

  // Load PDF document once
  useEffect(() => {
    if (!url) return;
    const absoluteUrl = url.startsWith("/")
      ? `${window.location.origin}${url}`
      : url;

    pdfjsLib
      .getDocument({
        url: absoluteUrl,
        cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/cmaps/",
        cMapPacked: true,
      })
      .promise.then(setPdfDoc)
      .catch((err) => console.error("Failed to load PDF:", err));
  }, [url]);

  /**
   * Render the current page(s) into the container.
   *
   * Called whenever pdfDoc, currentPage, spreadMode, or container size changes.
   * Each call fully clears the container and re-renders — simple, no race conditions.
   */
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !containerRef.current) return;

    // Clear existing content
    while (containerRef.current.firstChild) {
      containerRef.current.removeChild(containerRef.current.firstChild);
    }

    // Which pages to render
    const pagesToRender: number[] = [];
    if (spreadMode === "single") {
      pagesToRender.push(currentPage);
    } else {
      pagesToRender.push(currentPage);
      if (currentPage < totalPages) {
        pagesToRender.push(currentPage + 1);
      }
    }

    // Calculate scale to fill the container
    const containerWidth = containerRef.current.clientWidth - 48;
    const pageWidth = spreadMode === "single" ? 612 : 306;
    const targetScale = containerWidth > 0 ? containerWidth / pageWidth : 1.5;

    for (const pageNum of pagesToRender) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: targetScale });

      // Page wrapper
      const pageDiv = document.createElement("div");
      pageDiv.style.position = "relative";
      pageDiv.style.width = `${viewport.width}px`;
      pageDiv.style.height = `${viewport.height}px`;
      pageDiv.style.display = "inline-block";
      pageDiv.style.verticalAlign = "top";
      pageDiv.style.marginRight = spreadMode === "double" && pagesToRender.length > 1 ? "4px" : "0";

      // Canvas
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      pageDiv.appendChild(canvas);

      // Text layer for selection — transparent but interactive
      const textLayerDiv = document.createElement("div");
      textLayerDiv.style.position = "absolute";
      textLayerDiv.style.top = "0";
      textLayerDiv.style.left = "0";
      textLayerDiv.style.right = "0";
      textLayerDiv.style.bottom = "0";
      textLayerDiv.style.overflow = "hidden";
      // Must NOT have pointerEvents: none — we need mouse events to reach the text layer
      textLayerDiv.classList.add("pdf-text-layer");

      const textContent = await page.getTextContent();
      const textLayerInstance = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport: viewport.clone({ dontFlip: true }),
      });
      await textLayerInstance.render();

      pageDiv.appendChild(textLayerDiv);
      containerRef.current!.appendChild(pageDiv);
    }
  }, [pdfDoc, currentPage, totalPages, spreadMode]);

  // Trigger render when any dependency changes
  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // Recalculate on resize
  useEffect(() => {
    const handleResize = () => renderPage();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [renderPage]);

  // Handle text selection from the text layer
  useEffect(() => {
    if (!onTextSelected) return;

    const handleMouseUp = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        const text = selection.toString().trim();
        if (text.length >= 2) {
          onTextSelected(text);
        }
        selection.removeAllRanges();
      }, 50);
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [onTextSelected]);

  const goToPrev = () => onPageChange?.(Math.max(1, currentPage - 1));
  const goToNext = () => onPageChange?.(Math.min(totalPages, currentPage + 1));

  return (
    <div className="relative flex flex-col items-center">
      {/* Spread mode toggle */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Layout:</span>
        <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
          {([
            { value: "single" as SpreadMode, label: "Single page", icon: <BookOpen size={14} /> },
            { value: "double" as SpreadMode, label: "Double page", icon: <BookOpenCheck size={14} /> },
          ]).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSpreadMode(opt.value)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                spreadMode === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={opt.label}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* PDF content container */}
      <div
        ref={containerRef}
        className="relative w-full overflow-auto rounded-lg border border-border bg-white shadow-sm"
        style={{ maxHeight: "calc(100vh - 300px)" }}
      >
        {!pdfDoc && (
          <div className="flex h-[60vh] items-center justify-center bg-muted/50">
            <div className="text-sm text-muted-foreground">Loading PDF...</div>
          </div>
        )}
      </div>

      {/* Page navigation */}
      <div className="mt-3 flex items-center justify-center gap-4">
        <button
          onClick={goToPrev}
          disabled={currentPage <= 1}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm text-muted-foreground min-w-[120px] text-center">
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={goToNext}
          disabled={currentPage >= totalPages}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
