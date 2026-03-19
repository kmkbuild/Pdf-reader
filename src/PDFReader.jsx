import { useState, useEffect, useRef, useCallback } from "react";

// ── PDF.js ───────────────────────────────────────────────────────────────────
const PV = "3.11.174";
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PV}/pdf.min.js`;
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PV}/pdf.worker.min.js`;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ── IndexedDB ────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("PDFReaderDB", 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs", { keyPath: "name" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}
async function dbSavePDF(name, buf, size, modified) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("pdfs", "readwrite");
    tx.objectStore("pdfs").put({ name, data: buf, size, modified });
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  });
}
async function dbGetAllPDFs() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("pdfs", "readonly");
    const r = tx.objectStore("pdfs").getAll();
    r.onsuccess = e => res(e.target.result || []);
    r.onerror = e => rej(e.target.error);
  });
}
async function dbDeletePDF(name) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("pdfs", "readwrite");
    tx.objectStore("pdfs").delete(name);
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  });
}
async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put({ key, value });
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  });
}
async function dbGet(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("settings", "readonly");
    const r = tx.objectStore("settings").get(key);
    r.onsuccess = e => res(e.target.result?.value ?? null);
    r.onerror = e => rej(e.target.error);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  if (h < 21) return "Good Evening";
  return "Good Night";
}
function coverHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const hues = [210, 230, 250, 270, 190, 200, 220];
  return hues[Math.abs(h) % hues.length];
}
async function scanDir(dh, depth = 0) {
  const out = [];
  if (depth > 6) return out;
  try {
    for await (const [n, h] of dh.entries()) {
      if (h.kind === "file" && n.toLowerCase().endsWith(".pdf")) {
        try { const f = await h.getFile(); out.push({ name: n.replace(/\.pdf$/i, ""), file: f, size: f.size, modified: f.lastModified }); } catch {}
      } else if (h.kind === "directory") out.push(...await scanDir(h, depth + 1));
    }
  } catch {}
  return out;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg0:    "#03050f",   // deepest bg
  bg1:    "#070d1a",   // main bg
  bg2:    "#0c1428",   // card bg
  bg3:    "#101e38",   // elevated
  glass:  "rgba(12,20,40,0.72)",
  glow:   "#2563eb",
  glowS:  "#1d4ed8",
  neon:   "#3b82f6",
  neonL:  "#60a5fa",
  purple: "#7c3aed",
  purpleL:"#a78bfa",
  border: "rgba(59,130,246,0.18)",
  borderG:"rgba(59,130,246,0.45)",
  tx:     "#e2e8f0",
  txM:    "#64748b",
  txD:    "#334155",
  white:  "#ffffff",
};

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("home");       // home | reader | ai
  const [screen, setScreen] = useState("home"); // home | reader
  const [pdfjsReady, setPdfjsReady] = useState(false);

  // Library
  const [library, setLibrary] = useState([]);
  const [recentBooks, setRecentBooks] = useState([]);
  const [libSearch, setLibSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState(null);
  const [permState, setPermState] = useState("unknown");
  const [showPerm, setShowPerm] = useState(false);

  // Reader
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [currentBook, setCurrentBook] = useState(null);
  const [toc, setToc] = useState([]);
  const [bookmarks, setBookmarks] = useState({});
  const [notes, setNotes] = useState({});
  const [noteInput, setNoteInput] = useState("");
  const [lastRead, setLastRead] = useState({});
  const [textCache, setTextCache] = useState({});
  const [showControls, setShowControls] = useState(true);
  const [activePanel, setActivePanel] = useState(null); // null | saved | goto | search | notes | toc | ai | voice
  const [goInput, setGoInput] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [searching, setSearching] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // AI
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiTyping, setAiTyping] = useState(false);

  // Voice
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const utterRef = useRef(null);

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1 });
  const controlsTimer = useRef(null);
  const aiEndRef = useRef(null);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadScript(PDFJS_URL).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      setPdfjsReady(true);
    });
    (async () => {
      try {
        const rows = await dbGetAllPDFs();
        if (rows.length) setLibrary(rows.map(r => ({ name: r.name, file: new File([r.data], r.name + ".pdf", { type: "application/pdf" }), size: r.size, modified: r.modified })));
        const [bm, nt, lr, rb, perm] = await Promise.all([dbGet("bookmarks"), dbGet("notes"), dbGet("lastRead"), dbGet("recentBooks"), dbGet("permState")]);
        if (bm) setBookmarks(bm);
        if (nt) setNotes(nt);
        if (lr) setLastRead(lr);
        if (rb) setRecentBooks(rb);
        if (perm === "granted" || perm === "skipped") setPermState(perm);
        else setTimeout(() => setShowPerm(true), 1000);
      } catch { setTimeout(() => setShowPerm(true), 1000); }
    })();
  }, []);

  // Android back
  useEffect(() => {
    window.history.pushState({}, "");
    const back = () => {
      if (activePanel) { setActivePanel(null); return; }
      if (screen === "reader") { setScreen("home"); setTab("home"); setPdfDoc(null); stopVoice(); }
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [screen, activePanel]);

  // Auto-save
  useEffect(() => { dbSet("bookmarks", bookmarks).catch(() => {}); }, [bookmarks]);
  useEffect(() => { dbSet("notes", notes).catch(() => {}); }, [notes]);
  useEffect(() => { dbSet("lastRead", lastRead).catch(() => {}); }, [lastRead]);
  useEffect(() => { dbSet("recentBooks", recentBooks).catch(() => {}); }, [recentBooks]);
  useEffect(() => { if (currentBook) setNoteInput(notes[currentBook.name]?.[currentPage] || ""); }, [currentPage, currentBook]);
  useEffect(() => { aiEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMessages]);

  const toast_ = (msg, type = "info") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2600); };

  // ── Controls auto-hide ────────────────────────────────────────────────────
  const touchControls = () => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => { if (!activePanel) setShowControls(false); }, 3500);
  };

  // ── Permission ────────────────────────────────────────────────────────────
  const grantPermission = async () => {
    if (!("showDirectoryPicker" in window)) {
      setShowPerm(false); setPermState("skipped"); dbSet("permState", "skipped").catch(() => {});
      fileInputRef.current.click(); return;
    }
    try {
      const dir = await window.showDirectoryPicker({ mode: "read" });
      setShowPerm(false); setPermState("granted"); await dbSet("permState", "granted");
      setScanning(true); toast_("Scanning your storage…");
      const found = await scanDir(dir); setScanning(false);
      if (!found.length) { toast_("No PDFs found."); return; }
      for (const b of found) { try { await dbSavePDF(b.name, await b.file.arrayBuffer(), b.size, b.modified); } catch {} }
      setLibrary(prev => { const s = new Set(prev.map(x => x.name)); return [...prev, ...found.filter(x => !s.has(x.name))]; });
      toast_(`Found ${found.length} PDFs!`, "success");
    } catch (e) { setScanning(false); if (e?.name !== "AbortError") toast_("Could not access folder."); setShowPerm(false); }
  };
  const skipPerm = () => { setShowPerm(false); setPermState("skipped"); dbSet("permState", "skipped").catch(() => {}); };

  // ── Add files ─────────────────────────────────────────────────────────────
  const handleFiles = async (files) => {
    if (!files?.length) return;
    const books = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"))
      .map(f => ({ name: f.name.replace(/\.pdf$/i, ""), file: f, size: f.size, modified: f.lastModified }));
    if (!books.length) return;
    for (const b of books) { try { await dbSavePDF(b.name, await b.file.arrayBuffer(), b.size, b.modified); } catch {} }
    setLibrary(prev => { const s = new Set(prev.map(x => x.name)); return [...prev, ...books.filter(x => !s.has(x.name))]; });
    toast_(`${books.length} PDF${books.length > 1 ? "s" : ""} added!`, "success");
  };

  // ── Open book ─────────────────────────────────────────────────────────────
  const openBook = async (book) => {
    if (!pdfjsReady) { toast_("Loading engine, please wait…"); return; }
    stopVoice();
    setCurrentBook(book); setToc([]); setSearchRes([]); setSearchQ(""); setTextCache([]); setActivePanel(null); setDrawerOpen(false);
    setRecentBooks(prev => [book.name, ...prev.filter(n => n !== book.name)].slice(0, 6));
    const resumePage = lastRead[book.name] || 1;
    try {
      const buf = await book.file.arrayBuffer();
      const doc = await window.pdfjsLib.getDocument({ data: buf, cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PV}/cmaps/`, cMapPacked: true, standardFontDataUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PV}/standard_fonts/` }).promise;
      setCurrentPage(resumePage); setNumPages(doc.numPages); setPdfDoc(doc);
      try { setToc(flattenOutline(await doc.getOutline())); } catch { setToc([]); }
      setScreen("reader"); setTab("reader"); setShowControls(true);
    } catch { toast_("Could not open this PDF.", "error"); }
  };

  const flattenOutline = (items, d = 0) => {
    if (!items) return [];
    return items.flatMap(i => [{ title: i.title, dest: i.dest, depth: d }, ...flattenOutline(i.items, d + 1)]);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const renderPage = useCallback(async (doc, pageNum, scaleOvr) => {
    if (!canvasRef.current || !doc) return;
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch {} }
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const ctr = containerRef.current;
      const availW = ctr ? ctr.clientWidth - 8 : window.innerWidth - 8;
      const natVP = page.getViewport({ scale: 1 });
      const fit = availW / natVP.width;
      const scale = scaleOvr !== undefined ? scaleOvr : fit;
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, vp.width, vp.height);
      const task = page.render({ canvasContext: ctx, viewport: vp, intent: "display" });
      renderTaskRef.current = task; await task.promise;
      if (scaleOvr === undefined) { setZoom(fit); }
    } catch (e) { if (e?.name !== "RenderingCancelledException") console.error(e); }
    finally { setRendering(false); }
  }, []);

  useEffect(() => { if (pdfDoc) renderPage(pdfDoc, currentPage, undefined); }, [pdfDoc, currentPage]);
  const zt = useRef(null);
  useEffect(() => { if (!pdfDoc) return; clearTimeout(zt.current); zt.current = setTimeout(() => renderPage(pdfDoc, currentPage, zoom), 150); }, [zoom]);

  // ── Pinch ─────────────────────────────────────────────────────────────────
  const onTS = (e) => { if (e.touches.length !== 2) return; const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY; pinchRef.current = { active: true, startDist: Math.hypot(dx, dy), startZoom: zoom }; };
  const onTM = (e) => { if (!pinchRef.current.active || e.touches.length !== 2) return; e.preventDefault(); const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY; const ratio = Math.hypot(dx, dy) / pinchRef.current.startDist; setZoom(parseFloat(Math.max(0.5, Math.min(4, pinchRef.current.startZoom * ratio)).toFixed(2))); };
  const onTE = () => { pinchRef.current.active = false; };

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToPage = (n) => { const p = Math.max(1, Math.min(n, numPages)); setCurrentPage(p); if (currentBook) setLastRead(prev => ({ ...prev, [currentBook.name]: p })); };
  const navToc = async (item) => { if (!pdfDoc || !item.dest) return; try { let d = item.dest; if (typeof d === "string") d = await pdfDoc.getDestination(d); if (!d) return; goToPage((await pdfDoc.getPageIndex(d[0])) + 1); setActivePanel(null); } catch {} };

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  const bKey = currentBook?.name || "";
  const bBms = bookmarks[bKey] || [];
  const isBm = bBms.includes(currentPage);
  const toggleBm = () => { if (isBm) { setBookmarks(p => ({ ...p, [bKey]: bBms.filter(x => x !== currentPage) })); toast_("Removed bookmark"); } else { setBookmarks(p => ({ ...p, [bKey]: [...bBms, currentPage].sort((a, b) => a - b) })); toast_(`Page ${currentPage} bookmarked!`, "success"); } };

  // ── Notes ─────────────────────────────────────────────────────────────────
  const bNotes = notes[bKey] || {};
  const saveNote = () => { const u = { ...bNotes }; if (!noteInput.trim()) delete u[currentPage]; else u[currentPage] = noteInput; setNotes(p => ({ ...p, [bKey]: u })); toast_(noteInput.trim() ? "Note saved!" : "Note deleted", "success"); };

  // ── Search PDF ────────────────────────────────────────────────────────────
  const getPageText = async (doc, p) => { if (textCache[p]) return textCache[p]; const page = await doc.getPage(p); const c = await page.getTextContent(); const t = c.items.map(i => i.str).join(" "); setTextCache(prev => ({ ...prev, [p]: t })); return t; };
  const runSearch = async () => { if (!pdfDoc || !searchQ.trim()) return; setSearching(true); setSearchRes([]); const q = searchQ.trim().toLowerCase(); const results = []; for (let p = 1; p <= numPages; p++) { try { const t = await getPageText(pdfDoc, p); const l = t.toLowerCase(); let idx = l.indexOf(q); const snips = []; while (idx !== -1 && snips.length < 2) { snips.push(t.slice(Math.max(0, idx - 30), Math.min(t.length, idx + q.length + 30))); idx = l.indexOf(q, idx + 1); } if (snips.length) results.push({ page: p, snips }); } catch {} } setSearchRes(results); setSearching(false); if (!results.length) toast_("No results found."); else toast_(`Found on ${results.length} page${results.length > 1 ? "s" : ""}!`, "success"); };

  // ── AI Chat (simulated) ────────────────────────────────────────────────────
  const sendAI = async () => {
    if (!aiInput.trim()) return;
    const msg = aiInput.trim(); setAiInput("");
    setAiMessages(prev => [...prev, { role: "user", text: msg }]);
    setAiTyping(true);
    // Simulated AI response
    await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
    const responses = [
      "Based on the PDF content, here's what I found: This document covers the key concepts related to your query. I've analyzed the relevant sections and extracted the most important information.",
      "Great question! The document discusses this topic in detail. The main points are: clarity of purpose, structured approach, and evidence-based conclusions.",
      "I've scanned the document for relevant information. The content suggests a comprehensive understanding of the subject matter with multiple supporting references.",
      "According to the PDF, the answer involves several key factors. Let me break them down into digestible points for better understanding.",
    ];
    const reply = responses[Math.floor(Math.random() * responses.length)];
    setAiTyping(false);
    setAiMessages(prev => [...prev, { role: "ai", text: reply }]);
  };

  // ── Voice (Text-to-Speech) ─────────────────────────────────────────────────
  const startVoice = async () => {
    if (!pdfDoc) return;
    try {
      const text = await getPageText(pdfDoc, currentPage);
      if (!text.trim()) { toast_("No readable text on this page."); return; }
      stopVoice();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = voiceSpeed;
      utter.onstart = () => setVoicePlaying(true);
      utter.onend = () => { setVoicePlaying(false); setVoiceProgress(0); };
      utter.onboundary = (e) => { if (e.name === "word") setVoiceProgress(e.charIndex / text.length); };
      utterRef.current = utter;
      window.speechSynthesis.speak(utter);
    } catch { toast_("Text-to-speech not available."); }
  };
  const stopVoice = () => { window.speechSynthesis?.cancel(); utterRef.current = null; setVoicePlaying(false); setVoiceProgress(0); };
  const toggleVoice = () => { if (voicePlaying) stopVoice(); else startVoice(); };

  // ── Filtered library ──────────────────────────────────────────────────────
  const filtLib = library.filter(b => b.name.toLowerCase().includes(libSearch.toLowerCase()));
  const recentList = recentBooks.map(n => library.find(b => b.name === n)).filter(Boolean);

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ height: "100vh", background: C.bg0, color: C.tx,
      fontFamily: "'SF Pro Display','-apple-system','Segoe UI',sans-serif",
      display: "flex", flexDirection: "column", overflow: "hidden",
      position: "relative" }}>

      {/* ── Ambient background glow ── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-20%", left: "-10%", width: "60%", height: "60%",
          background: "radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 70%)",
          borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: "-20%", right: "-10%", width: "50%", height: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.10) 0%, transparent 70%)",
          borderRadius: "50%" }} />
      </div>

      {/* ── Permission popup ── */}
      {showPerm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "linear-gradient(135deg,#0c1428,#101e38)",
            borderRadius: 24, padding: 32, maxWidth: 340, width: "100%",
            border: `1px solid ${C.borderG}`,
            boxShadow: `0 0 60px rgba(37,99,235,0.3), 0 32px 64px rgba(0,0,0,0.6)` }}>
            <div style={{ fontSize: 48, textAlign: "center", marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.neonL, textAlign: "center", marginBottom: 8 }}>Storage Access</div>
            <div style={{ fontSize: 14, color: C.txM, lineHeight: 1.8, textAlign: "center", marginBottom: 28 }}>
              Allow PDF Reader to scan your device and find all PDF books automatically.
            </div>
            <GlowButton label="📂 Allow & Scan Storage" onClick={grantPermission} full />
            <div style={{ height: 10 }} />
            <GlowButton label="Pick PDFs Manually" onClick={() => { setShowPerm(false); skipPerm(); fileInputRef.current.click(); }} full outline />
            <button onClick={skipPerm} style={{ background: "none", border: "none", width: "100%",
              color: C.txM, fontSize: 13, cursor: "pointer", padding: "12px", fontFamily: "inherit",
              marginTop: 4 }}>Don't ask again</button>
          </div>
        </div>
      )}

      {/* ── Drawer ── */}
      {drawerOpen && <div style={{ position: "fixed", inset: 0, zIndex: 80,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={() => setDrawerOpen(false)} />}
      <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: 300, zIndex: 90,
        background: "linear-gradient(180deg,#070d1a,#0c1428)",
        borderRight: `1px solid ${C.border}`,
        transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform .28s cubic-bezier(.4,0,.2,1)",
        backdropFilter: "blur(20px)", display: "flex", flexDirection: "column",
        boxShadow: drawerOpen ? `6px 0 60px rgba(37,99,235,0.2)` : "none" }}>
        <div style={{ padding: "24px 20px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 22, fontWeight: 800, background: `linear-gradient(135deg,${C.neonL},${C.purpleL})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              PDF Reader
            </div>
            <button onClick={() => setDrawerOpen(false)}
              style={{ background: "none", border: "none", color: C.txM, fontSize: 22, cursor: "pointer" }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: C.txM, marginTop: 4 }}>{library.length} books in library</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 8px" }}>
          {[
            { icon: "🏠", label: "My Library", sub: `${library.length} books`, action: () => { setScreen("home"); setTab("home"); setPdfDoc(null); stopVoice(); setDrawerOpen(false); } },
            { icon: "➕", label: "Add PDF", sub: "Import from device", action: () => { setDrawerOpen(false); fileInputRef.current.click(); } },
            { icon: "📂", label: "Scan Storage", sub: "Find all PDFs in folder", action: async () => { setDrawerOpen(false); await grantPermission(); } },
            ...(screen === "reader" ? [
              null,
              { icon: "🔖", label: "Saved Pages", sub: `${bBms.length} in this book`, action: () => { setActivePanel("saved"); setDrawerOpen(false); } },
              { icon: "🔢", label: "Go to Page", sub: `Page ${currentPage} of ${numPages}`, action: () => { setActivePanel("goto"); setDrawerOpen(false); } },
              { icon: "🔍", label: "Search PDF", sub: "Full text search", action: () => { setActivePanel("search"); setDrawerOpen(false); } },
              { icon: "✏️", label: "Notes", sub: `${Object.keys(bNotes).length} notes`, action: () => { setActivePanel("notes"); setDrawerOpen(false); } },
              { icon: "📑", label: "Contents", sub: toc.length > 0 ? `${toc.length} sections` : "None", action: () => { setActivePanel("toc"); setDrawerOpen(false); } },
            ] : []),
          ].map((item, i) => item === null
            ? <div key={i} style={{ height: 1, background: C.border, margin: "8px 12px" }} />
            : (
              <div key={i} onClick={item.action}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px",
                  borderRadius: 14, cursor: "pointer", marginBottom: 2, transition: "background .15s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.1)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ fontSize: 20, width: 28, textAlign: "center" }}>{item.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.tx }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: C.txM }}>{item.sub}</div>
                </div>
                <div style={{ color: C.txD, fontSize: 14 }}>›</div>
              </div>
            )
          )}
        </div>
      </div>

      {/* ── SCREENS ── */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>

        {/* ════ HOME SCREEN ════ */}
        {tab === "home" && (
          <div style={{ height: "100%", overflowY: "auto", padding: "0 0 90px" }}>
            {/* Header */}
            <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button onClick={() => setDrawerOpen(true)}
                style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
                  borderRadius: 12, width: 40, height: 40, cursor: "pointer",
                  color: C.tx, fontSize: 18, display: "flex", alignItems: "center",
                  justifyContent: "center" }}>☰</button>
              <button onClick={() => fileInputRef.current.click()}
                style={{ background: `linear-gradient(135deg,${C.glow},${C.purple})`,
                  border: "none", borderRadius: 12, padding: "8px 16px",
                  color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  boxShadow: `0 4px 20px rgba(37,99,235,0.5)` }}>
                + Import
              </button>
            </div>

            {/* Greeting */}
            <div style={{ padding: "24px 20px 0" }}>
              <div style={{ fontSize: 13, color: C.txM, fontWeight: 500, marginBottom: 4 }}>
                {getGreeting()} 👋
              </div>
              <div style={{ fontSize: 26, fontWeight: 800,
                background: `linear-gradient(135deg,${C.white},${C.neonL})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Your Library
              </div>
              <div style={{ fontSize: 13, color: C.txM, marginTop: 4 }}>
                {library.length} book{library.length !== 1 ? "s" : ""} · Ready to read
              </div>
            </div>

            {/* Search */}
            <div style={{ padding: "16px 20px 0" }}>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 14, top: "50%",
                  transform: "translateY(-50%)", fontSize: 15, color: C.txM }}>🔍</span>
                <input value={libSearch} onChange={e => setLibSearch(e.target.value)}
                  placeholder="Search books…"
                  style={{ width: "100%", padding: "12px 14px 12px 40px",
                    borderRadius: 14, border: `1px solid ${C.border}`,
                    background: "rgba(255,255,255,0.05)",
                    backdropFilter: "blur(10px)",
                    color: C.tx, fontSize: 14, fontFamily: "inherit",
                    outline: "none", boxSizing: "border-box",
                    transition: "border .2s" }}
                  onFocus={e => e.target.style.borderColor = C.neon}
                  onBlur={e => e.target.style.borderColor = C.border} />
                {libSearch && (
                  <button onClick={() => setLibSearch("")}
                    style={{ position: "absolute", right: 12, top: "50%",
                      transform: "translateY(-50%)", background: "none",
                      border: "none", cursor: "pointer", color: C.txM, fontSize: 18 }}>×</button>
                )}
              </div>
            </div>

            {library.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", minHeight: "55vh", gap: 16, textAlign: "center",
                padding: "0 32px" }}>
                <div style={{ fontSize: 64, filter: "drop-shadow(0 0 20px rgba(59,130,246,0.5))" }}>📖</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.neonL }}>No books yet</div>
                <div style={{ fontSize: 14, color: C.txM, lineHeight: 1.8 }}>
                  Import your first PDF to start reading
                </div>
                <GlowButton label="📂 Import PDF" onClick={() => fileInputRef.current.click()} />
              </div>
            ) : (
              <>
                {/* Recent */}
                {recentList.length > 0 && !libSearch && (
                  <div style={{ padding: "24px 20px 0" }}>
                    <SectionLabel label="Recently Opened" />
                    <div style={{ display: "flex", gap: 14, overflowX: "auto",
                      paddingBottom: 4, scrollbarWidth: "none" }}>
                      {recentList.slice(0, 6).map((book, i) => (
                        <RecentCard key={i} book={book} lastPage={lastRead[book.name]}
                          hue={coverHue(book.name)}
                          onOpen={() => openBook(book)}
                          onRemove={() => setRecentBooks(prev => prev.filter(n => n !== book.name))} />
                      ))}
                    </div>
                  </div>
                )}

                {/* All books */}
                <div style={{ padding: "24px 20px 0" }}>
                  <SectionLabel label={libSearch ? `Results (${filtLib.length})` : `All Books (${library.length})`} />
                  {filtLib.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "32px 0", color: C.txM }}>
                      No books match "<span style={{ color: C.neonL }}>{libSearch}</span>"
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                      {filtLib.map((book, i) => (
                        <LibCard key={i} book={book} hue={coverHue(book.name)}
                          lastPage={lastRead[book.name]}
                          bmsCount={(bookmarks[book.name] || []).length}
                          onOpen={() => openBook(book)}
                          onDelete={() => {
                            if (window.confirm(`Remove "${book.name}"?`)) {
                              dbDeletePDF(book.name).catch(() => {});
                              setLibrary(prev => prev.filter(b => b.name !== book.name));
                              setRecentBooks(prev => prev.filter(n => n !== book.name));
                              toast_("Removed from library");
                            }
                          }} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ════ READER SCREEN ════ */}
        {tab === "reader" && screen === "reader" && (
          <div style={{ height: "100%", position: "relative", background: "#1a1a2e" }}>
            {/* Canvas scroll area */}
            <div ref={containerRef}
              onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE}
              onClick={() => { touchControls(); if (activePanel) setActivePanel(null); }}
              style={{ width: "100%", height: "100%", overflowY: "auto", overflowX: "auto",
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "8px 4px 80px", WebkitOverflowScrolling: "touch",
                background: "linear-gradient(180deg,#0f0f1a,#1a1a2e)" }}>
              {rendering && (
                <div style={{ position: "fixed", top: 16, left: "50%",
                  transform: "translateX(-50%)", zIndex: 20,
                  background: C.glass, backdropFilter: "blur(12px)",
                  border: `1px solid ${C.borderG}`, borderRadius: 20,
                  padding: "6px 18px", fontSize: 12, color: C.neonL }}>
                  Rendering…
                </div>
              )}
              <div style={{ borderRadius: 8, overflow: "hidden",
                boxShadow: `0 0 60px rgba(37,99,235,0.15), 0 32px 80px rgba(0,0,0,0.8)` }}>
                <canvas ref={canvasRef} style={{ display: "block" }} />
              </div>
              {bNotes[currentPage] && (
                <div dir="auto" style={{ margin: "14px 8px 0",
                  maxWidth: 600, width: "calc(100% - 16px)",
                  background: C.glass, backdropFilter: "blur(12px)",
                  border: `1px solid ${C.border}`, borderRadius: 14,
                  padding: "12px 16px", fontSize: 13, color: C.txM }}>
                  <span style={{ color: C.neonL, fontWeight: 700 }}>✏️ Note: </span>
                  {bNotes[currentPage]}
                </div>
              )}
            </div>

            {/* Top bar — fades with controls */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0,
              background: "linear-gradient(180deg,rgba(7,13,26,0.95),transparent)",
              padding: "14px 16px 24px",
              opacity: showControls ? 1 : 0, transition: "opacity .3s",
              pointerEvents: showControls ? "auto" : "none",
              display: "flex", alignItems: "center", gap: 10, zIndex: 10 }}>
              <button onClick={() => setDrawerOpen(true)}
                style={{ ...glassBtn(), width: 38, height: 38 }}>☰</button>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.neonL,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {currentBook?.name}
                </div>
                <div style={{ fontSize: 10, color: C.txM }}>
                  Page {currentPage} of {numPages}
                </div>
              </div>
              <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.2).toFixed(1)))} style={glassBtn()}>−</button>
              <span style={{ fontSize: 10, color: C.txM, minWidth: 36, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(4, +(z + 0.2).toFixed(1)))} style={glassBtn()}>+</button>
            </div>

            {/* Page nav — left/right arrows */}
            <div style={{ position: "absolute", bottom: 90, left: 0, right: 0,
              display: "flex", justifyContent: "space-between", padding: "0 16px",
              opacity: showControls ? 1 : 0, transition: "opacity .3s",
              pointerEvents: showControls ? "auto" : "none" }}>
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}
                style={{ ...glassBtn(), opacity: currentPage === 1 ? 0.3 : 1,
                  width: 44, height: 44, fontSize: 18 }}>◀</button>
              {/* Page progress pill */}
              <div style={{ background: C.glass, backdropFilter: "blur(12px)",
                border: `1px solid ${C.border}`, borderRadius: 20,
                padding: "8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: C.tx, fontWeight: 700 }}>
                  {currentPage} / {numPages}
                </span>
                <div style={{ width: 80, height: 4, background: C.bg3, borderRadius: 4 }}>
                  <div style={{ height: "100%", background: `linear-gradient(90deg,${C.neon},${C.purple})`,
                    borderRadius: 4, width: `${(currentPage / numPages) * 100}%`,
                    transition: "width .3s", boxShadow: `0 0 8px ${C.neon}` }} />
                </div>
              </div>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === numPages}
                style={{ ...glassBtn(), opacity: currentPage === numPages ? 0.3 : 1,
                  width: 44, height: 44, fontSize: 18 }}>▶</button>
            </div>

            {/* Floating bottom action bar */}
            <div style={{ position: "absolute", bottom: 10, left: "50%",
              transform: "translateX(-50%)",
              background: C.glass, backdropFilter: "blur(20px)",
              border: `1px solid ${C.borderG}`,
              borderRadius: 28, padding: "10px 20px",
              display: "flex", gap: 24, alignItems: "center",
              boxShadow: `0 0 40px rgba(37,99,235,0.25), 0 16px 40px rgba(0,0,0,0.5)`,
              opacity: showControls ? 1 : 0, transition: "opacity .3s",
              pointerEvents: showControls ? "auto" : "none", zIndex: 10 }}>
              {[
                { icon: "🎧", tip: "Listen", action: () => setActivePanel("voice"), active: activePanel === "voice" },
                { icon: "🤖", tip: "AI", action: () => setActivePanel("ai"), active: activePanel === "ai" },
                { icon: isBm ? "🔖" : "🏷️", tip: "Bookmark", action: toggleBm, active: isBm },
                { icon: "✏️", tip: "Notes", action: () => setActivePanel("notes"), active: activePanel === "notes" },
                { icon: "📄", tip: "Pages", action: () => setActivePanel("goto"), active: activePanel === "goto" },
                { icon: "🔍", tip: "Search", action: () => setActivePanel("search"), active: activePanel === "search" },
              ].map((item, i) => (
                <button key={i} onClick={item.action} title={item.tip}
                  style={{ background: "none", border: "none", cursor: "pointer",
                    fontSize: 22, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 2, position: "relative",
                    filter: item.active ? `drop-shadow(0 0 8px ${C.neon})` : "none",
                    transition: "filter .2s, transform .15s",
                    transform: item.active ? "scale(1.15)" : "scale(1)" }}>
                  {item.icon}
                  {item.active && (
                    <div style={{ width: 4, height: 4, borderRadius: "50%",
                      background: C.neon, boxShadow: `0 0 8px ${C.neon}` }} />
                  )}
                </button>
              ))}
            </div>

            {/* ── PANELS ── */}
            {activePanel && (
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0,
                background: "linear-gradient(180deg,rgba(7,13,26,0.98),rgba(7,13,26,1))",
                backdropFilter: "blur(20px)",
                border: `1px solid ${C.border}`, borderTop: `1px solid ${C.borderG}`,
                borderRadius: "24px 24px 0 0",
                maxHeight: "65vh", overflowY: "auto",
                zIndex: 20, animation: "slideUp .3s cubic-bezier(.4,0,.2,1)",
                boxShadow: `0 -20px 60px rgba(37,99,235,0.15)` }}>
                {/* Handle */}
                <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
                  <div style={{ width: 36, height: 4, borderRadius: 4,
                    background: `linear-gradient(90deg,${C.neon},${C.purple})`,
                    boxShadow: `0 0 8px ${C.neon}`, cursor: "pointer" }}
                    onClick={() => setActivePanel(null)} />
                </div>

                <div style={{ padding: "0 20px 100px" }}>

                  {/* SAVED PAGES */}
                  {activePanel === "saved" && (
                    <>
                      <PanelTitle title="🔖 Saved Pages" />
                      <GlowButton label={isBm ? "Remove from Saved" : `Save Page ${currentPage}`}
                        onClick={toggleBm} outline={isBm} />
                      <div style={{ height: 16 }} />
                      {bBms.length === 0 ? <EmptyState msg="No saved pages yet." /> :
                        bBms.map(pg => (
                          <div key={pg} onClick={() => { goToPage(pg); setActivePanel(null); }}
                            style={{ ...glassCard(pg === currentPage), marginBottom: 10,
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              cursor: "pointer" }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700,
                                color: pg === currentPage ? C.neonL : C.tx }}>Page {pg}</div>
                              {bNotes[pg] && <div style={{ fontSize: 11, color: C.txM, marginTop: 2 }}>✏️ Has note</div>}
                            </div>
                            <button onClick={e => { e.stopPropagation(); setBookmarks(p => ({ ...p, [bKey]: bBms.filter(x => x !== pg) })); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: C.txM, fontSize: 20 }}>×</button>
                          </div>
                        ))}
                    </>
                  )}

                  {/* GO TO PAGE */}
                  {activePanel === "goto" && (
                    <>
                      <PanelTitle title="🔢 Go to Page" />
                      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <input type="number" value={goInput} onChange={e => setGoInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { goToPage(parseInt(goInput)); setGoInput(""); setActivePanel(null); } }}
                          placeholder={`1 – ${numPages}`}
                          style={{ flex: 1, padding: "14px 16px", borderRadius: 14,
                            border: `1px solid ${C.borderG}`, background: "rgba(255,255,255,0.05)",
                            color: C.tx, fontSize: 16, fontFamily: "inherit", outline: "none" }} />
                        <button onClick={() => { goToPage(parseInt(goInput)); setGoInput(""); setActivePanel(null); }}
                          style={{ background: `linear-gradient(135deg,${C.glow},${C.purple})`,
                            border: "none", borderRadius: 14, padding: "14px 22px",
                            color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14,
                            boxShadow: `0 4px 20px rgba(37,99,235,0.5)` }}>Go</button>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {[1, Math.floor(numPages * .25), Math.floor(numPages * .5), Math.floor(numPages * .75), numPages]
                          .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
                          .map(pg => (
                            <button key={pg} onClick={() => { goToPage(pg); setActivePanel(null); }}
                              style={{ background: pg === currentPage ? `linear-gradient(135deg,${C.glow},${C.purple})` : "rgba(255,255,255,0.06)",
                                border: `1px solid ${pg === currentPage ? C.neon : C.border}`,
                                color: pg === currentPage ? "#fff" : C.tx,
                                padding: "10px 16px", borderRadius: 12, fontSize: 12,
                                cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                                boxShadow: pg === currentPage ? `0 4px 16px rgba(37,99,235,0.4)` : "none" }}>
                              {pg === 1 ? "First" : pg === numPages ? "Last" : `Page ${pg}`}
                            </button>
                          ))}
                      </div>
                    </>
                  )}

                  {/* SEARCH */}
                  {activePanel === "search" && (
                    <>
                      <PanelTitle title="🔍 Search PDF" />
                      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                        <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && runSearch()}
                          placeholder="Search entire document…" dir="auto"
                          style={{ flex: 1, padding: "14px 16px", borderRadius: 14,
                            border: `1px solid ${C.borderG}`, background: "rgba(255,255,255,0.05)",
                            color: C.tx, fontSize: 14, fontFamily: "inherit", outline: "none" }} />
                        <button onClick={runSearch}
                          style={{ background: `linear-gradient(135deg,${C.glow},${C.purple})`,
                            border: "none", borderRadius: 14, padding: "14px 20px",
                            color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14,
                            boxShadow: `0 4px 20px rgba(37,99,235,0.5)` }}>Go</button>
                      </div>
                      {searching && <div style={{ textAlign: "center", color: C.neonL, padding: 16 }}>Searching {numPages} pages…</div>}
                      {!searching && searchQ && !searchRes.length && <EmptyState msg={`No results for "${searchQ}"`} />}
                      {searchRes.map((r, i) => (
                        <div key={i} onClick={() => { goToPage(r.page); setActivePanel(null); }}
                          style={{ ...glassCard(r.page === currentPage), marginBottom: 10, cursor: "pointer" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.neonL, marginBottom: 6 }}>Page {r.page}</div>
                          {r.snips.map((s, j) => <div key={j} dir="auto" style={{ fontSize: 11, color: C.txM, lineHeight: 1.6 }}>…{s.trim()}…</div>)}
                        </div>
                      ))}
                    </>
                  )}

                  {/* NOTES */}
                  {activePanel === "notes" && (
                    <>
                      <PanelTitle title={`✏️ Note — Page ${currentPage}`} />
                      <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)}
                        dir="auto" placeholder="Write your note here…"
                        style={{ width: "100%", minHeight: 110, padding: 14, borderRadius: 14,
                          border: `1px solid ${C.borderG}`, background: "rgba(255,255,255,0.05)",
                          color: C.tx, fontSize: 14, fontFamily: "inherit", resize: "vertical",
                          boxSizing: "border-box", outline: "none", lineHeight: 1.7, marginBottom: 12 }} />
                      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <GlowButton label="Save Note" onClick={saveNote} />
                        {bNotes[currentPage] && <GlowButton label="Delete" onClick={() => { setNoteInput(""); const u = { ...bNotes }; delete u[currentPage]; setNotes(p => ({ ...p, [bKey]: u })); toast_("Deleted"); }} outline />}
                      </div>
                      {Object.keys(bNotes).length > 0 && (
                        <>
                          <div style={{ fontSize: 11, color: C.txM, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>All Notes</div>
                          {Object.entries(bNotes).sort(([a], [b]) => Number(a) - Number(b)).map(([pg, note]) => (
                            <div key={pg} onClick={() => { goToPage(Number(pg)); setActivePanel(null); }}
                              style={{ ...glassCard(Number(pg) === currentPage), marginBottom: 8, cursor: "pointer" }}>
                              <div style={{ fontSize: 12, color: C.neonL, fontWeight: 700, marginBottom: 4 }}>Page {pg}</div>
                              <div dir="auto" style={{ fontSize: 12, color: C.txM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</div>
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  )}

                  {/* TABLE OF CONTENTS */}
                  {activePanel === "toc" && (
                    <>
                      <PanelTitle title="📑 Table of Contents" />
                      {toc.length === 0 ? <EmptyState msg="This PDF has no table of contents." /> :
                        toc.map((item, i) => (
                          <div key={i} dir="auto" onClick={() => navToc(item)}
                            style={{ padding: "11px 14px", paddingLeft: 14 + item.depth * 18,
                              borderRadius: 12, cursor: "pointer", marginBottom: 4,
                              fontSize: item.depth === 0 ? 14 : 12,
                              fontWeight: item.depth === 0 ? 700 : 400,
                              color: item.depth === 0 ? C.neonL : C.tx,
                              borderLeft: item.depth > 0 ? `2px solid ${C.border}` : "none",
                              transition: "background .15s" }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.08)"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            {item.title}
                          </div>
                        ))}
                    </>
                  )}

                  {/* AI PANEL */}
                  {activePanel === "ai" && (
                    <>
                      <PanelTitle title="🤖 AI Assistant" />
                      <div style={{ background: "rgba(59,130,246,0.08)", borderRadius: 14,
                        padding: "12px 16px", marginBottom: 16,
                        border: `1px solid ${C.border}` }}>
                        <div style={{ fontSize: 12, color: C.neonL, fontWeight: 700, marginBottom: 6 }}>📄 Current Page Summary</div>
                        <div style={{ fontSize: 12, color: C.txM, lineHeight: 1.7 }}>
                          AI-powered analysis of Page {currentPage}. Ask me anything about the content of this document.
                        </div>
                      </div>
                      {/* Chat messages */}
                      <div style={{ minHeight: 80, marginBottom: 12 }}>
                        {aiMessages.length === 0 && (
                          <div style={{ textAlign: "center", color: C.txM, fontSize: 13, padding: "16px 0" }}>
                            Ask me anything about this PDF ✨
                          </div>
                        )}
                        {aiMessages.map((msg, i) => (
                          <div key={i} style={{ display: "flex",
                            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                            marginBottom: 10 }}>
                            <div style={{
                              maxWidth: "80%", padding: "10px 14px", borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                              background: msg.role === "user"
                                ? `linear-gradient(135deg,${C.glow},${C.purple})`
                                : "rgba(255,255,255,0.08)",
                              border: msg.role === "user" ? "none" : `1px solid ${C.border}`,
                              fontSize: 13, color: C.tx, lineHeight: 1.6,
                              boxShadow: msg.role === "user" ? `0 4px 20px rgba(37,99,235,0.4)` : "none" }}>
                              {msg.text}
                            </div>
                          </div>
                        ))}
                        {aiTyping && (
                          <div style={{ display: "flex", gap: 4, padding: "10px 14px",
                            background: "rgba(255,255,255,0.06)", borderRadius: "18px 18px 18px 4px",
                            width: "fit-content", border: `1px solid ${C.border}` }}>
                            {[0, 1, 2].map(i => (
                              <div key={i} style={{ width: 6, height: 6, borderRadius: "50%",
                                background: C.neon, animation: `bounce .8s ease ${i * .15}s infinite`,
                                boxShadow: `0 0 6px ${C.neon}` }} />
                            ))}
                          </div>
                        )}
                        <div ref={aiEndRef} />
                      </div>
                      {/* Chat input */}
                      <div style={{ display: "flex", gap: 10 }}>
                        <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && sendAI()}
                          placeholder="Ask about this PDF…"
                          style={{ flex: 1, padding: "12px 16px", borderRadius: 20,
                            border: `1px solid ${C.borderG}`, background: "rgba(255,255,255,0.05)",
                            color: C.tx, fontSize: 14, fontFamily: "inherit", outline: "none" }} />
                        <button onClick={sendAI}
                          style={{ background: `linear-gradient(135deg,${C.glow},${C.purple})`,
                            border: "none", borderRadius: 20, padding: "12px 20px",
                            color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14,
                            boxShadow: `0 4px 20px rgba(37,99,235,0.5)` }}>↑</button>
                      </div>
                    </>
                  )}

                  {/* VOICE PANEL */}
                  {activePanel === "voice" && (
                    <>
                      <PanelTitle title="🎧 Voice Reader" />
                      {/* Waveform animation */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                        gap: 4, margin: "20px 0", height: 60 }}>
                        {Array.from({ length: 20 }).map((_, i) => (
                          <div key={i} style={{ width: 4, borderRadius: 4,
                            background: voicePlaying
                              ? `linear-gradient(180deg,${C.neon},${C.purple})`
                              : C.txD,
                            height: voicePlaying ? `${20 + Math.sin(i * 0.8) * 20 + 20}%` : "20%",
                            transition: "height .15s",
                            animation: voicePlaying ? `wave .6s ease ${i * .05}s infinite alternate` : "none",
                            boxShadow: voicePlaying ? `0 0 8px ${C.neon}` : "none" }} />
                        ))}
                      </div>
                      {/* Progress */}
                      <div style={{ height: 4, background: C.bg3, borderRadius: 4, marginBottom: 20 }}>
                        <div style={{ height: "100%", borderRadius: 4,
                          background: `linear-gradient(90deg,${C.neon},${C.purple})`,
                          width: `${voiceProgress * 100}%`, transition: "width .3s",
                          boxShadow: `0 0 10px ${C.neon}` }} />
                      </div>
                      {/* Play button */}
                      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
                        <button onClick={toggleVoice}
                          style={{ width: 72, height: 72, borderRadius: "50%",
                            background: `linear-gradient(135deg,${C.glow},${C.purple})`,
                            border: "none", cursor: "pointer",
                            fontSize: 28, color: "#fff",
                            boxShadow: `0 0 40px rgba(37,99,235,0.6), 0 8px 32px rgba(0,0,0,0.4)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "transform .15s" }}
                          onMouseEnter={e => e.currentTarget.style.transform = "scale(1.08)"}
                          onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                          {voicePlaying ? "⏸" : "▶"}
                        </button>
                      </div>
                      {/* Speed */}
                      <div style={{ textAlign: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: 12, color: C.txM, marginBottom: 8 }}>
                          Speed: <span style={{ color: C.neonL, fontWeight: 700 }}>{voiceSpeed}x</span>
                        </div>
                        <input type="range" min="0.5" max="2" step="0.25"
                          value={voiceSpeed}
                          onChange={e => { setVoiceSpeed(parseFloat(e.target.value)); if (voicePlaying) { stopVoice(); setTimeout(startVoice, 100); } }}
                          style={{ width: "80%", accentColor: C.neon }} />
                        <div style={{ display: "flex", justifyContent: "space-between",
                          width: "80%", margin: "4px auto 0", fontSize: 10, color: C.txM }}>
                          <span>0.5x</span><span>1x</span><span>1.5x</span><span>2x</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ AI TOOLS TAB ════ */}
        {tab === "ai" && (
          <div style={{ height: "100%", overflowY: "auto", padding: "20px 20px 100px" }}>
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 6,
              background: `linear-gradient(135deg,${C.neonL},${C.purpleL})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              AI Tools
            </div>
            <div style={{ fontSize: 13, color: C.txM, marginBottom: 28 }}>
              {screen === "reader" ? `Analyzing: ${currentBook?.name}` : "Open a book to use AI tools"}
            </div>

            {screen !== "reader" ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 16, filter: "drop-shadow(0 0 16px rgba(59,130,246,0.5))" }}>🤖</div>
                <div style={{ color: C.txM, fontSize: 14, lineHeight: 1.8 }}>
                  Open a PDF from your library<br />to use AI features
                </div>
              </div>
            ) : (
              <>
                {/* AI feature cards */}
                {[
                  { icon: "📋", title: "Page Summary", desc: `Quick summary of page ${currentPage}`, action: () => { setActivePanel("ai"); setTab("reader"); } },
                  { icon: "💬", title: "Chat with PDF", desc: "Ask questions about the content", action: () => { setActivePanel("ai"); setTab("reader"); } },
                  { icon: "🎧", title: "Listen to Page", desc: "Text-to-speech for current page", action: () => { setActivePanel("voice"); setTab("reader"); } },
                  { icon: "🔍", title: "Search Content", desc: "Find anything in the document", action: () => { setActivePanel("search"); setTab("reader"); } },
                ].map((card, i) => (
                  <div key={i} onClick={card.action}
                    style={{ ...glassCard(false), marginBottom: 12, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 16,
                      transition: "border-color .2s, box-shadow .2s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderG; e.currentTarget.style.boxShadow = `0 0 20px rgba(37,99,235,0.2)`; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}>
                    <div style={{ fontSize: 28, width: 48, height: 48,
                      background: "rgba(59,130,246,0.12)", borderRadius: 14,
                      display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {card.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.tx, marginBottom: 2 }}>{card.title}</div>
                      <div style={{ fontSize: 12, color: C.txM }}>{card.desc}</div>
                    </div>
                    <div style={{ color: C.neon, fontSize: 18 }}>›</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Navigation Bar ── */}
      <div style={{ flexShrink: 0, background: C.glass, backdropFilter: "blur(20px)",
        borderTop: `1px solid ${C.border}`,
        display: "flex", position: "relative", zIndex: 10,
        boxShadow: `0 -4px 40px rgba(37,99,235,0.1)` }}>
        {[
          { key: "home",   icon: "⊞",  label: "Library" },
          { key: "reader", icon: "📖", label: "Reader"  },
          { key: "ai",     icon: "🤖", label: "AI Tools" },
        ].map(item => {
          const active = tab === item.key;
          return (
            <button key={item.key}
              onClick={() => { setTab(item.key); if (item.key === "reader" && screen !== "reader") setTab("home"); }}
              style={{ flex: 1, background: "transparent", border: "none",
                cursor: "pointer", padding: "12px 4px 14px", fontFamily: "inherit",
                position: "relative" }}>
              {active && (
                <div style={{ position: "absolute", top: 0, left: "20%", right: "20%",
                  height: 2, background: `linear-gradient(90deg,${C.neon},${C.purple})`,
                  borderRadius: "0 0 4px 4px",
                  boxShadow: `0 0 10px ${C.neon}` }} />
              )}
              <div style={{ fontSize: 20, marginBottom: 2,
                filter: active ? `drop-shadow(0 0 8px ${C.neon})` : "none",
                transition: "filter .2s" }}>
                {item.icon}
              </div>
              <div style={{ fontSize: 10, fontWeight: active ? 700 : 500,
                color: active ? C.neonL : C.txM, transition: "color .2s" }}>
                {item.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%",
          transform: "translateX(-50%)",
          background: toast.type === "success"
            ? `linear-gradient(135deg,${C.glow},${C.purple})`
            : C.glass,
          backdropFilter: "blur(12px)",
          color: "#fff", padding: "10px 22px", borderRadius: 24, fontSize: 13,
          boxShadow: `0 4px 28px rgba(37,99,235,0.4)`,
          border: `1px solid ${C.borderG}`,
          zIndex: 500, whiteSpace: "nowrap", animation: "fadeUp .2s ease",
          fontWeight: 600 }}>
          {toast.msg}
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".pdf,application/pdf"
        multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />

      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes bounce{0%{transform:scaleY(0.6)}100%{transform:scaleY(1.4)}}
        @keyframes wave{0%{height:20%}100%{height:80%}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(59,130,246,0.3);border-radius:4px}
        input::-webkit-inner-spin-button{opacity:.5}
        *{box-sizing:border-box}
        input:focus,textarea:focus{outline:none}
        input[type=range]{-webkit-appearance:none;height:4px;border-radius:4px;background:rgba(59,130,246,0.2)}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);cursor:pointer;box-shadow:0 0 10px rgba(37,99,235,0.6)}
      `}</style>
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────
function GlowButton({ label, onClick, full, outline }) {
  return (
    <button onClick={onClick} style={{
      background: outline ? "transparent" : `linear-gradient(135deg,${C.glow},${C.purple})`,
      border: `1px solid ${outline ? C.borderG : "transparent"}`,
      color: "#fff", padding: "13px 24px", borderRadius: 14,
      fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      width: full ? "100%" : "auto",
      boxShadow: outline ? "none" : `0 4px 24px rgba(37,99,235,0.5)`,
      transition: "transform .15s, box-shadow .15s" }}
      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.02)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}>
      {label}
    </button>
  );
}
function SectionLabel({ label }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 800, color: C.txM,
      textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 14 }}>
      {label}
    </div>
  );
}
function PanelTitle({ title }) {
  return <div style={{ fontSize: 17, fontWeight: 800, color: C.tx, marginBottom: 16 }}>{title}</div>;
}
function EmptyState({ msg }) {
  return <div style={{ textAlign: "center", color: C.txM, padding: "20px 0", fontSize: 14 }}>{msg}</div>;
}
function glassBtn() {
  return {
    background: C.glass, backdropFilter: "blur(12px)",
    border: `1px solid ${C.border}`, borderRadius: 12,
    color: C.tx, cursor: "pointer", fontSize: 16,
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 36, height: 36, transition: "border-color .15s",
  };
}
function glassCard(active) {
  return {
    background: active ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.04)",
    backdropFilter: "blur(10px)",
    border: `1px solid ${active ? C.borderG : C.border}`,
    borderRadius: 16, padding: "14px 16px",
    boxShadow: active ? `0 0 20px rgba(37,99,235,0.2)` : "none",
    transition: "all .2s",
  };
}

function RecentCard({ book, lastPage, hue, onOpen, onRemove }) {
  return (
    <div style={{ flexShrink: 0, width: 110, position: "relative", cursor: "pointer" }}
      onClick={onOpen}>
      <div style={{ height: 150, borderRadius: 16,
        background: `linear-gradient(160deg, hsl(${hue},60%,30%), hsl(${hue+30},50%,18%))`,
        border: `1px solid hsl(${hue},40%,40%)`,
        boxShadow: `0 0 20px hsla(${hue},60%,40%,0.3), 0 8px 32px rgba(0,0,0,0.5)`,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "12px 8px", gap: 8, marginBottom: 8,
        transition: "transform .2s, box-shadow .2s" }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 0 30px hsla(${hue},60%,40%,0.5), 0 16px 40px rgba(0,0,0,0.6)`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = `0 0 20px hsla(${hue},60%,40%,0.3), 0 8px 32px rgba(0,0,0,0.5)`; }}>
        <div style={{ fontSize: 24 }}>📄</div>
        <div dir="auto" style={{ fontSize: 9, color: `hsl(${hue},20%,85%)`, textAlign: "center",
          fontWeight: 700, lineHeight: 1.4, display: "-webkit-box",
          WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {book.name}
        </div>
        {lastPage && (
          <div style={{ fontSize: 9, color: `hsl(${hue},40%,70%)`,
            background: "rgba(0,0,0,0.3)", borderRadius: 8,
            padding: "2px 6px" }}>Pg {lastPage}</div>
        )}
      </div>
      <div dir="auto" style={{ fontSize: 10, fontWeight: 600, color: C.txM,
        lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {book.name}
      </div>
      <button onClick={e => { e.stopPropagation(); onRemove(); }}
        style={{ position: "absolute", top: 6, right: 6,
          background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%",
          width: 18, height: 18, cursor: "pointer", color: C.txM, fontSize: 11,
          display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
    </div>
  );
}

function LibCard({ book, hue, lastPage, bmsCount, onOpen, onDelete }) {
  return (
    <div style={{ position: "relative", animation: "fadeIn .3s ease both" }}>
      <div onClick={onOpen} style={{ cursor: "pointer" }}>
        <div style={{ aspectRatio: "2/3", borderRadius: 14,
          background: `linear-gradient(160deg, hsl(${hue},55%,28%), hsl(${hue+30},45%,16%))`,
          border: `1px solid hsl(${hue},35%,35%)`,
          boxShadow: `0 0 16px hsla(${hue},50%,35%,0.25), 0 6px 24px rgba(0,0,0,0.5)`,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "10px 6px", gap: 6, marginBottom: 6,
          transition: "transform .2s, box-shadow .2s" }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = `0 0 24px hsla(${hue},50%,35%,0.4), 0 12px 32px rgba(0,0,0,0.6)`; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = `0 0 16px hsla(${hue},50%,35%,0.25), 0 6px 24px rgba(0,0,0,0.5)`; }}>
          <div style={{ fontSize: 20 }}>📄</div>
          <div dir="auto" style={{ fontSize: 8, color: `hsl(${hue},15%,88%)`,
            textAlign: "center", fontWeight: 700, lineHeight: 1.3,
            display: "-webkit-box", WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {book.name}
          </div>
          {bmsCount > 0 && (
            <div style={{ position: "absolute", top: 5, right: 5,
              background: "rgba(0,0,0,0.7)", borderRadius: 8,
              padding: "1px 5px", fontSize: 8, color: C.neonL,
              border: `1px solid ${C.border}` }}>🔖{bmsCount}</div>
          )}
        </div>
        <div dir="auto" style={{ fontSize: 9, fontWeight: 700, color: C.txM,
          lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {book.name}
        </div>
        {lastPage && <div style={{ fontSize: 8, color: C.neon, marginTop: 1 }}>Pg {lastPage}</div>}
      </div>
      <button onClick={onDelete}
        style={{ position: "absolute", top: 4, left: 4,
          background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%",
          width: 16, height: 16, cursor: "pointer", color: C.txM, fontSize: 10,
          display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
    </div>
  );
}
