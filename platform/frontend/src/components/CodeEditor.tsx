import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

const ZIG_KEYWORDS = [
  "const", "var", "fn", "pub", "if", "else", "while", "for", "return",
  "try", "catch", "defer", "errdefer", "struct", "enum", "union", "switch",
  "comptime", "inline", "extern", "export", "usingnamespace", "test",
  "anytype", "void", "bool", "i8", "i16", "i32", "i64", "u8", "u16",
  "u32", "u64", "usize", "isize", "f32", "f64", "anyerror", "null",
  "undefined", "true", "false", "unreachable", "noreturn", "type",
  "async", "await", "suspend", "resume", "break", "continue", "error",
  "packed", "align", "allowzero", "volatile", "callconv",
];

function registerZig(monaco: typeof Monaco) {
  if (monaco.languages.getLanguages().find((l) => l.id === "zig")) return;

  monaco.languages.register({ id: "zig" });
  monaco.languages.setMonarchTokensProvider("zig", {
    keywords: ZIG_KEYWORDS,
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/@[a-zA-Z_]\w*/, "builtin"],
        [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/\b0x[0-9a-fA-F]+|\b\d+\.?\d*/, "number"],
        [/[{}()[\]]/, "delimiter"],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);

  monaco.editor.defineTheme("zig-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c96b0c", fontStyle: "bold" },
      { token: "comment", foreground: "9ca3af", fontStyle: "italic" },
      { token: "string", foreground: "16a34a" },
      { token: "number", foreground: "d97706" },
      { token: "builtin", foreground: "E08A00", fontStyle: "bold" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#111111",
      "editorLineNumber.foreground": "#9ca3af",
      "editor.lineHighlightBackground": "#f6f5f318",
      "editorCursor.foreground": "#F7A41D",
      "editor.selectionBackground": "#F7A41D28",
    },
  });

  monaco.editor.defineTheme("zig-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "F7A41D", fontStyle: "bold" },
      { token: "comment", foreground: "6e7681", fontStyle: "italic" },
      { token: "string", foreground: "7ee787" },
      { token: "number", foreground: "ffa657" },
      { token: "builtin", foreground: "F7A41D", fontStyle: "bold" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#e6edf3",
      "editorLineNumber.foreground": "#6e7681",
      "editor.lineHighlightBackground": "#161b2260",
      "editorCursor.foreground": "#F7A41D",
      "editor.selectionBackground": "#388bfd33",
    },
  });
}

export function parseZigDiagnostics(
  stderr: string,
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
): Monaco.editor.IMarkerData[] {
  const markers: Monaco.editor.IMarkerData[] = [];
  const re = /^([^:]+):(\d+):(\d+):\s*(error|note|warning):\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const [, , lineStr, colStr, severity, message] = m;
    const line = parseInt(lineStr, 10);
    const col = parseInt(colStr, 10);
    markers.push({
      severity:
        severity === "error"
          ? monaco.MarkerSeverity.Error
          : severity === "warning"
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
      message,
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: model.getLineMaxColumn(line),
    });
  }
  return markers;
}

interface Props {
  value?: string;
  onChange?: (value: string | undefined) => void;
  height?: string;
  readOnly?: boolean;
  darkMode?: boolean;
  stderr?: string;
  exitCode?: number;
}

export function CodeEditor({
  value,
  onChange,
  height = "100%",
  readOnly = false,
  darkMode = false,
  stderr,
  exitCode,
}: Props) {
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  // Keep a ref so onMount always sees the latest darkMode value
  const darkModeRef = useRef(darkMode);
  darkModeRef.current = darkMode;

  // Immediately apply theme — also handles the case where darkMode changes
  // before the editor has finished mounting (ref may be null on first effect run)
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco) return;
    // setTheme is global; render(true) forces immediate visual repaint
    monaco.editor.setTheme(darkMode ? "zig-dark" : "zig-light");
    editor?.render(true);
  }, [darkMode]);

  // Error markers
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (exitCode !== 0 && stderr) {
      monaco.editor.setModelMarkers(model, "zig", parseZigDiagnostics(stderr, monaco, model));
    } else {
      monaco.editor.setModelMarkers(model, "zig", []);
    }
  }, [stderr, exitCode]);

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editorRef.current = editor;
    // Apply correct theme immediately — by the time onMount fires, the ref
    // might have a different darkMode than when the component first rendered
    monaco.editor.setTheme(darkModeRef.current ? "zig-dark" : "zig-light");
  };

  return (
    <Editor
      height={height}
      language="zig"
      theme={darkMode ? "zig-dark" : "zig-light"}
      beforeMount={registerZig}
      onMount={handleMount}
      value={value}
      onChange={onChange}
      options={{
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
        minimap: { enabled: false },
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        padding: { top: 16, bottom: 16 },
        readOnly,
        wordWrap: "on",
        tabSize: 4,
        insertSpaces: true,
        renderLineHighlight: "line",
        smoothScrolling: true,
      }}
    />
  );
}
