import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

export type TextMode = "plain" | "latex";
export type LatexPanelMode = "off" | "on" | "math";

const EX_HEIGHT_RATIO = 0.43;
const LATEX_VERTICAL_INSET_RATIO = 0.3;
const FALLBACK_CHARACTER_WIDTH_RATIO = 0.6;

interface MathJaxRenderer {
  adaptor: ReturnType<typeof liteAdaptor>;
  document: ReturnType<typeof mathjax.document>;
}

export interface LatexSvgRender {
  baselineOffset: number;
  height: number;
  markup: string;
  viewBox: {
    height: number;
    minX: number;
    minY: number;
    width: number;
  };
  width: number;
}

let mathJaxRenderer: MathJaxRenderer | null = null;
const latexSvgCache = new Map<string, LatexSvgRender | null>();

const createMathJaxRenderer = (): MathJaxRenderer => {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  return {
    adaptor,
    document: mathjax.document("", {
      InputJax: new TeX({ packages: AllPackages }),
      OutputJax: new SVG({ fontCache: "none" }),
    }),
  };
};

const getMathJaxRenderer = (): MathJaxRenderer => {
  mathJaxRenderer ??= createMathJaxRenderer();
  return mathJaxRenderer;
};

const formatNumber = (value: number): string =>
  Number(value.toFixed(3)).toString();

const parseLengthAttribute = (
  markup: string,
  attribute: "width" | "height",
): string | null => {
  const match = markup.match(new RegExp(`\\b${attribute}="([^"]+)"`));
  return match?.[1] ?? null;
};

const parseVerticalAlign = (markup: string): string | null => {
  const match = markup.match(/vertical-align:\s*([^;"]+)/);
  return match?.[1] ?? null;
};

const parseViewBox = (markup: string): LatexSvgRender["viewBox"] | null => {
  const match = markup.match(/\bviewBox="([^"]+)"/);
  if (!match) {
    return null;
  }

  const values = match[1]
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value));

  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    minX: values[0],
    minY: values[1],
    width: values[2],
    height: values[3],
  };
};

const convertMathUnitToDocumentUnits = (
  value: string | null,
  fontSize: number,
): number => {
  if (!value) {
    return 0;
  }

  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (value.endsWith("ex")) {
    return numeric * fontSize * EX_HEIGHT_RATIO;
  }

  if (value.endsWith("em")) {
    return numeric * fontSize;
  }

  return numeric;
};

const normalizeLatexSvgMarkup = (
  markup: string,
  width: number,
  height: number,
): string => {
  const svgStart = markup.indexOf("<svg");
  const svgEnd = markup.indexOf("</svg>", svgStart);
  const withoutContainer =
    svgStart >= 0 && svgEnd >= 0
      ? markup.slice(svgStart, svgEnd + "</svg>".length)
      : markup;
  const withoutRootStyle = withoutContainer.replace(/\sstyle="[^"]*"/, "");
  const withWidth = withoutRootStyle.replace(
    /\bwidth="[^"]*"/,
    `width="${formatNumber(width)}"`,
  );
  const withHeight = withWidth.replace(
    /\bheight="[^"]*"/,
    `height="${formatNumber(height)}"`,
  );

  return withHeight.replace(
    "<svg ",
    `<svg overflow="visible" preserveAspectRatio="xMinYMin meet" data-tex-renderer="mathjax" `,
  );
};

export const getTextMode = (element: { textMode?: TextMode | null }) =>
  element.textMode ?? "plain";

export const isLatexTextMode = (textMode: TextMode | null | undefined) =>
  textMode === "latex";

export const isInlineMathText = (text: string): boolean => {
  const trimmed = text.trim();
  return (
    trimmed.length >= 2 && trimmed.startsWith("$") && trimmed.endsWith("$")
  );
};

export const stripLatexMathDelimiters = (text: string): string => {
  const trimmed = text.trim();
  return isInlineMathText(trimmed) ? trimmed.slice(1, -1) : text;
};

export const getLatexPanelMode = (
  textMode: TextMode | null | undefined,
  text: string,
): LatexPanelMode => {
  if (textMode !== "latex") {
    return "off";
  }
  return isInlineMathText(text) ? "math" : "on";
};

export const getLatexPanelSource = (
  mode: LatexPanelMode,
  text: string,
): string => (mode === "math" ? stripLatexMathDelimiters(text) : text);

export const formatLatexText = (
  mode: LatexPanelMode,
  source: string,
): string => {
  if (mode === "math") {
    return `$${stripLatexMathDelimiters(source)}$`;
  }
  return mode === "off" ? stripLatexMathDelimiters(source) : source;
};

export const getNextLatexPanelMode = (mode: LatexPanelMode): LatexPanelMode =>
  mode === "off" ? "on" : mode === "on" ? "math" : "off";

export const renderLatexToSvg = (
  source: string,
  fontSize: number,
): LatexSvgRender | null => {
  const cacheKey = `${fontSize}:${source}`;
  if (latexSvgCache.has(cacheKey)) {
    return latexSvgCache.get(cacheKey) ?? null;
  }

  try {
    const { adaptor, document } = getMathJaxRenderer();
    const node = document.convert(stripLatexMathDelimiters(source), {
      display: false,
    });
    const markup = adaptor.outerHTML(node);
    const width = convertMathUnitToDocumentUnits(
      parseLengthAttribute(markup, "width"),
      fontSize,
    );
    const height = convertMathUnitToDocumentUnits(
      parseLengthAttribute(markup, "height"),
      fontSize,
    );
    const verticalAlign = convertMathUnitToDocumentUnits(
      parseVerticalAlign(markup),
      fontSize,
    );
    const viewBox = parseViewBox(markup);

    if (
      !viewBox ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      latexSvgCache.set(cacheKey, null);
      return null;
    }

    const render = {
      width,
      height,
      baselineOffset: Math.max(fontSize * 0.6, height + verticalAlign),
      markup: normalizeLatexSvgMarkup(markup, width, height),
      viewBox,
    };

    latexSvgCache.set(cacheKey, render);
    return render;
  } catch {
    latexSvgCache.set(cacheKey, null);
    return null;
  }
};

export const measureLatex = (source: string, fontSize: number) => {
  const rendered = renderLatexToSvg(source, fontSize);

  if (!rendered) {
    return {
      width:
        Math.max(1, source.length) * fontSize * FALLBACK_CHARACTER_WIDTH_RATIO,
      height: fontSize,
    };
  }

  const contentInsetY = fontSize * LATEX_VERTICAL_INSET_RATIO;
  return {
    width: rendered.width,
    height: rendered.height + contentInsetY * 2,
  };
};

const parseTransformArgs = (args: string): number[] =>
  args
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));

const applySvgTransform = (
  context: CanvasRenderingContext2D,
  transform: string | null,
) => {
  if (!transform) {
    return;
  }

  for (const match of transform.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const [, name, argsSource] = match;
    const args = parseTransformArgs(argsSource);

    if (name === "translate") {
      context.translate(args[0] || 0, args[1] || 0);
    } else if (name === "scale") {
      context.scale(args[0] || 1, args.length > 1 ? args[1] : args[0] || 1);
    } else if (name === "matrix" && args.length >= 6) {
      context.transform(args[0], args[1], args[2], args[3], args[4], args[5]);
    } else if (name === "rotate") {
      context.rotate(((args[0] || 0) * Math.PI) / 180);
    }
  }
};

const parseSvgMarkup = (markup: string): SVGSVGElement | null => {
  if (typeof DOMParser === "undefined") {
    return null;
  }

  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.documentElement;

  if (svg.nodeName.toLowerCase() === "parsererror") {
    return null;
  }

  return svg as unknown as SVGSVGElement;
};

const getUseHref = (element: SVGElement): string | null =>
  element.getAttribute("href") ||
  element.getAttribute("xlink:href") ||
  element.getAttributeNS("http://www.w3.org/1999/xlink", "href");

const drawSvgNode = (
  context: CanvasRenderingContext2D,
  node: SVGElement,
  definitions: Map<string, SVGElement>,
): boolean => {
  const tagName = node.tagName.toLowerCase();

  if (tagName === "defs") {
    return true;
  }

  context.save();
  applySvgTransform(context, node.getAttribute("transform"));

  if (tagName === "path") {
    const pathData = node.getAttribute("d");
    if (pathData && typeof Path2D !== "undefined") {
      context.fill(new Path2D(pathData));
    }
  } else if (tagName === "rect") {
    context.fillRect(
      Number.parseFloat(node.getAttribute("x") || "0"),
      Number.parseFloat(node.getAttribute("y") || "0"),
      Number.parseFloat(node.getAttribute("width") || "0"),
      Number.parseFloat(node.getAttribute("height") || "0"),
    );
  } else if (tagName === "use") {
    const href = getUseHref(node);
    const referenced = href?.startsWith("#")
      ? definitions.get(href.slice(1))
      : null;

    if (referenced) {
      context.translate(
        Number.parseFloat(node.getAttribute("x") || "0"),
        Number.parseFloat(node.getAttribute("y") || "0"),
      );
      drawSvgNode(context, referenced, definitions);
    }
  } else {
    for (const child of Array.from(node.children)) {
      drawSvgNode(context, child as SVGElement, definitions);
    }
  }

  context.restore();
  return true;
};

export const drawLatexSvgToCanvas = (
  context: CanvasRenderingContext2D,
  render: LatexSvgRender,
  options: {
    color: string;
    x: number;
    y: number;
  },
): boolean => {
  if (typeof Path2D === "undefined") {
    return false;
  }

  const svg = parseSvgMarkup(render.markup);
  if (!svg) {
    return false;
  }

  const definitions = new Map<string, SVGElement>();
  svg.querySelectorAll<SVGElement>("[id]").forEach((node) => {
    const id = node.getAttribute("id");
    if (id) {
      definitions.set(id, node);
    }
  });

  const scaleX = render.width / render.viewBox.width;
  const scaleY = render.height / render.viewBox.height;

  context.save();
  context.fillStyle = options.color;
  context.translate(options.x, options.y);
  context.scale(scaleX, scaleY);
  context.translate(-render.viewBox.minX, -render.viewBox.minY);

  for (const child of Array.from(svg.children)) {
    drawSvgNode(context, child as SVGElement, definitions);
  }

  context.restore();
  return true;
};

export const createLatexSvgElement = (
  ownerDocument: Document,
  render: LatexSvgRender,
): SVGSVGElement | null => {
  const svg = parseSvgMarkup(render.markup);
  if (!svg) {
    return null;
  }

  return ownerDocument.importNode(svg, true) as SVGSVGElement;
};

export const getLatexContentInsetY = (fontSize: number) =>
  fontSize * LATEX_VERTICAL_INSET_RATIO;
