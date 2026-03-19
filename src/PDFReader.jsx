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
const DB_NAME = "PDFReaderDB", DB_VER = 1;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pdfs"))
        db.createObjectStore("pdfs", { keyPath: "name" });
      if (!db.objectStoreNames.contains("settings"))
        db.createObjectStore("settings", { keyPath: "key" });
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
async function dbSaveSetting(key, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put({ key, value });
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  });
}
async function dbGetSetting(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("settings", "readonly");
    const r = tx.objectStore("settings").get(key);
    r.onsuccess = e => res(e.target.result?.value ?? null);
    r.onerror = e => rej(e.target.error);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function coverColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const hues = [14, 30, 48, 190, 220, 260, 340];
  const hue = hues[Math.abs(h) % hues.length];
  return { bg: `hsl(${hue},50%,42%)`, spine: `hsl(${hue},50%,28%)`, text: `hsl(${hue},15%,92%)` };
}

async function scanDir(dirHandle, depth = 0) {
  const pdfs = [];
  if (depth > 5) return pdfs;
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".pdf")) {
      const file = await handle.getFile();
      pdfs.push({ name: name.replace(/\.pdf$/i, ""), file, size: file.size, modified: file.lastModified });
    } else if (handle.kind === "directory") {
      pdfs.push(...await scanDir(handle, depth + 1));
    }
  }
  return pdfs;
}

// ════════════════════════════════════════════════════════════════════════════
export default function PDFReader() {
  const [screen, setScreen] = useState("library");
  const [pdfjsReady, setPdfjsReady] = useState(false);
  const [dark, setDark] = useState(false);

  // Library
  const [library, setLibrary] = useState([]);
  const [recentBooks, setRecentBooks] = useState([]); // names of recently opened
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState(null);
  const [storagePermission, setStoragePermission] = useState("ask"); // "ask"|"granted"|"denied"|"skip"
  const [showPermPopup, setShowPermPopup] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Reader
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [baseZoom, setBaseZoom] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [currentBook, setCurrentBook] = useState(null);
  const [toc, setToc] = useState([]);
  const [bookmarks, setBookmarks] = useState({});
  const [notes, setNotes] = useState({});
  const [noteInput, setNoteInput] = useState("");
  const [lastRead, setLastRead] = useState({});
  const [textCache, setTextCache] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const [goInput, setGoInput] = useState("");
  const [readerDrawerOpen, setReaderDrawerOpen] = useState(false);
  const [allBookmarksView, setAllBookmarksView] = useState(false);

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1 });

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadScript(PDFJS_URL).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      setPdfjsReady(true);
    });
    dbGetAllPDFs().then(rows => {
      if (!rows.length) return;
      setLibrary(rows.map(r => ({
        name: r.name,
        file: new File([r.data], r.name + ".pdf", { type: "application/pdf" }),
        size: r.size, modified: r.modified,
      })));
    }).catch(() => {});
    dbGetSetting("bookmarks").then(v => { if (v) setBookmarks(v); }).catch(() => {});
    dbGetSetting("notes").then(v => { if (v) setNotes(v); }).catch(() => {});
    dbGetSetting("lastRead").then(v => { if (v) setLastRead(v); }).catch(() => {});
    dbGetSetting("dark").then(v => { if (v !== null) setDark(v); }).catch(() => {});
    dbGetSetting("recentBooks").then(v => { if (v) setRecentBooks(v); }).catch(() => {});
    dbGetSetting("storagePermission").then(v => {
      if (v) { setStoragePermission(v); }
      else { setTimeout(() => setShowPermPopup(true), 800); }
    }).catch(() => { setTimeout(() => setShowPermPopup(true), 800); });
  }, []);

  // Android hardware back button
  useEffect(() => {
    const handleBack = (e) => {
      if (screen === "reader") {
        e.preventDefault();
        setScreen("library");
        setPdfDoc(null);
        setActivePanel(null);
        setReaderDrawerOpen(false);
      }
    };
    window.addEventListener("popstate", handleBack);
    // Push a state so back button triggers popstate
    window.history.pushState({ page: "app" }, "");
    return () => window.removeEventListener("popstate", handleBack);
  }, [screen]);

  // Auto-save settings
  useEffect(() => { dbSaveSetting("bookmarks", bookmarks).catch(() => {}); }, [bookmarks]);
  useEffect(() => { dbSaveSetting("notes", notes).catch(() => {}); }, [notes]);
  useEffect(() => { dbSaveSetting("lastRead", lastRead).catch(() => {}); }, [lastRead]);
  useEffect(() => { dbSaveSetting("dark", dark).catch(() => {}); }, [dark]);
  useEffect(() => { dbSaveSetting("recentBooks", recentBooks).catch(() => {}); }, [recentBooks]);

  useEffect(() => {
    if (currentBook) setNoteInput(notes[currentBook.name]?.[currentPage] || "");
  }, [currentPage, currentBook]);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // ── Storage permission popup handler ──────────────────────────────────────
  const handleGrantPermission = async () => {
    if (!("showDirectoryPicker" in window)) {
      setShowPermPopup(false);
      setStoragePermission("skip");
      dbSaveSetting("storagePermission", "skip").catch(() => {});
      fileInputRef.current.click();
      return;
    }
    try {
      const dir = await window.showDirectoryPicker({ mode: "read" });
      setShowPermPopup(false);
      setStoragePermission("granted");
      dbSaveSetting("storagePermission", "granted").catch(() => {});
      setScanning(true);
      const found = await scanDir(dir);
      setScanning(false);
      if (found.length) {
        for (const book of found) {
          try {
            const buf = await book.file.arrayBuffer();
            await dbSavePDF(book.name, buf, book.size, book.modified);
          } catch {}
        }
        setLibrary(prev => {
          const names = new Set(prev.map(b => b.name));
          return [...prev, ...found.filter(b => !names.has(b.name))];
        });
        showToast(`Found ${found.length} PDFs and saved to library!`, "success");
      } else {
        showToast("No PDFs found, but permission granted.");
      }
    } catch (e) {
      setScanning(false);
      if (e?.name !== "AbortError") showToast("Could not access storage.");
      setShowPermPopup(false);
    }
  };

  const handleDontAskAgain = () => {
    setShowPermPopup(false);
    setStoragePermission("skip");
    dbSaveSetting("storagePermission", "skip").catch(() => {});
  };

  // ── Add PDFs ──────────────────────────────────────────────────────────────
  const handleFiles = async (files) => {
    if (!files?.length) return;
    const newBooks = Array.from(files)
      .filter(f => f.name.toLowerCase().endsWith(".pdf"))
      .map(f => ({ name: f.name.replace(/\.pdf$/i, ""), file: f, size: f.size, modified: f.lastModified }));
    if (!newBooks.length) { showToast("No PDF files selected."); return; }
    for (const book of newBooks) {
      try {
        const buf = await book.file.arrayBuffer();
        await dbSavePDF(book.name, buf, book.size, book.modified);
      } catch {}
    }
    setLibrary(prev => {
      const names = new Set(prev.map(b => b.name));
      return [...prev, ...newBooks.filter(b => !names.has(b.name))];
    });
    showToast(`${newBooks.length} PDF${newBooks.length > 1 ? "s" : ""} added to library!`, "success");
  };

  // ── Open book ─────────────────────────────────────────────────────────────
  const openBook = async (book) => {
    if (!pdfjsReady) { showToast("PDF engine loading, please wait…"); return; }
    setCurrentBook(book);
    const resumePage = lastRead[book.name] || 1;
    setToc([]); setSearchResults([]); setSearchQuery("");
    setTextCache({}); setActivePanel(null); setReaderDrawerOpen(false);
    setAllBookmarksView(false);

    // Update recents
    setRecentBooks(prev => {
      const filtered = prev.filter(n => n !== book.name);
      return [book.name, ...filtered].slice(0, 6);
    });

    try {
      const buf = await book.file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({
        data: buf,
        cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PV}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PV}/standard_fonts/`,
      });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setCurrentPage(resumePage);
      try { setToc(flattenOutline(await doc.getOutline())); } catch { setToc([]); }
      setScreen("reader");
    } catch (e) {
      console.error(e);
      showToast("Could not open this PDF. It may be corrupted.", "error");
    }
  };

  const flattenOutline = (items, depth = 0) => {
    if (!items) return [];
    return items.flatMap(i => [
      { title: i.title, dest: i.dest, depth },
      ...flattenOutline(i.items, depth + 1),
    ]);
  };

  // ── Render page (fix blur with devicePixelRatio) ──────────────────────────
  const renderPage = useCallback(async (doc, pageNum, scaleOverride) => {
    if (!canvasRef.current || !doc) return;
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch {}
    }
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const container = containerRef.current;
      const availW = container ? container.clientWidth - 16 : window.innerWidth - 16;
      const naturalVP = page.getViewport({ scale: 1 });
      const fitScale = availW / naturalVP.width;
      const scale = scaleOverride || fitScale;

      // Use devicePixelRatio for sharp rendering (fixes blur!)
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      // Physical pixels = CSS pixels × DPR
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, vp.width, vp.height);

      const task = page.render({
        canvasContext: ctx,
        viewport: vp,
        intent: "display",
      });
      renderTaskRef.current = task;
      await task.promise;

      if (!scaleOverride) {
        setBaseZoom(fitScale);
        setZoom(fitScale);
      }
    } catch (e) {
      if (e?.name !== "RenderingCancelledException") console.error("Render:", e);
    } finally {
      setRendering(false);
    }
  }, []);

  // Re-render when page or zoom changes
  useEffect(() => {
    if (pdfDoc) renderPage(pdfDoc, currentPage, zoom !== baseZoom ? zoom : null);
  }, [pdfDoc, currentPage]);

  // Re-render on zoom change with debounce
  const zoomTimer = useRef(null);
  useEffect(() => {
    if (!pdfDoc) return;
    clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => {
      renderPage(pdfDoc, currentPage, zoom);
    }, 120);
  }, [zoom]);

  // ── Pinch to zoom ─────────────────────────────────────────────────────────
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = {
        active: true,
        startDist: Math.hypot(dx, dy),
        startZoom: zoom,
      };
    }
  };
  const handleTouchMove = (e) => {
    if (!pinchRef.current.active || e.touches.length !== 2) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const ratio = dist / pinchRef.current.startDist;
    const newZoom = Math.max(0.5, Math.min(4, pinchRef.current.startZoom * ratio));
    setZoom(parseFloat(newZoom.toFixed(2)));
  };
  const handleTouchEnd = () => { pinchRef.current.active = false; };

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToPage = (n) => {
    const p = Math.max(1, Math.min(n, numPages));
    setCurrentPage(p);
    if (currentBook) setLastRead(prev => ({ ...prev, [currentBook.name]: p }));
  };

  const navigateToc = async (item) => {
    if (!pdfDoc || !item.dest) return;
    try {
      let dest = item.dest;
      if (typeof dest === "string") dest = await pdfDoc.getDestination(dest);
      if (!dest) return;
      goToPage((await pdfDoc.getPageIndex(dest[0])) + 1);
      setActivePanel(null); setReaderDrawerOpen(false);
    } catch {}
  };

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  const bookKey = currentBook?.name || "";
  const bookBookmarks = bookmarks[bookKey] || [];
  const isBookmarked = bookBookmarks.includes(currentPage);
  const toggleBookmark = () => {
    if (isBookmarked) {
      setBookmarks(p => ({ ...p, [bookKey]: bookBookmarks.filter(b => b !== currentPage) }));
      showToast("Removed from saved pages");
    } else {
      setBookmarks(p => ({ ...p, [bookKey]: [...bookBookmarks, currentPage].sort((a, b) => a - b) }));
      showToast(`Page ${currentPage} saved!`, "success");
    }
  };

  // All bookmarks across all books
  const allBookmarks = Object.entries(bookmarks).flatMap(([bName, pages]) =>
    pages.map(pg => ({ bookName: bName, page: pg }))
  );

  // ── Notes ─────────────────────────────────────────────────────────────────
  const bookNotes = notes[bookKey] || {};
  const saveNote = () => {
    const updated = { ...bookNotes };
    if (!noteInput.trim()) delete updated[currentPage];
    else updated[currentPage] = noteInput;
    setNotes(p => ({ ...p, [bookKey]: updated }));
    showToast(noteInput.trim() ? "Note saved!" : "Note deleted", "success");
  };

  // ── Search ────────────────────────────────────────────────────────────────
  const getPageText = async (doc, p) => {
    if (textCache[p]) return textCache[p];
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    const text = c.items.map(i => i.str).join(" ");
    setTextCache(prev => ({ ...prev, [p]: text }));
    return text;
  };
  const runSearch = async () => {
    if (!pdfDoc || !searchQuery.trim()) return;
    setSearching(true); setSearchResults([]);
    const q = searchQuery.trim().toLowerCase();
    const results = [];
    for (let p = 1; p <= numPages; p++) {
      try {
        const text = await getPageText(pdfDoc, p);
        const lower = text.toLowerCase();
        let idx = lower.indexOf(q);
        const snippets = [];
        while (idx !== -1 && snippets.length < 2) {
          snippets.push(text.slice(Math.max(0, idx - 30), Math.min(text.length, idx + q.length + 30)));
          idx = lower.indexOf(q, idx + 1);
        }
        if (snippets.length) results.push({ page: p, snippets });
      } catch {}
    }
    setSearchResults(results); setSearching(false);
    if (!results.length) showToast("No results found.");
    else showToast(`Found on ${results.length} page${results.length > 1 ? "s" : ""}!`, "success");
  };

  // ── Theme ─────────────────────────────────────────────────────────────────
  const d = dark;
  const bg       = d ? "#111"    : "#f7f3ee";
  const surface  = d ? "#1c1c1c" : "#ffffff";
  const panelBg  = d ? "#181818" : "#fdfaf6";
  const drawerBg = d ? "#161616" : "#ffffff";
  const border   = d ? "#2a2a2a" : "#e0d8cc";
  const tx       = d ? "#e8e0d0" : "#1a1208";
  const muted    = d ? "#666"    : "#8a7a68";
  const acc      = d ? "#c9a96e" : "#b5681e";
  const accL     = d ? "#c9a96e22" : "#b5681e14";
  const inputBg  = d ? "#222"    : "#f5f0e8";
  const cvsBg    = d ? "#1a1818" : "#e8e0d4";

  // Recently opened books
  const recentList = recentBooks
    .map(name => library.find(b => b.name === name))
    .filter(Boolean);

  const removeFromRecent = (name) => {
    setRecentBooks(prev => prev.filter(n => n !== name));
  };

  // Style helpers
  const panelStyle = {
    position: "absolute", bottom: 0, left: 0, right: 0,
    background: panelBg, borderTop: `2px solid ${border}`,
    borderRadius: "20px 20px 0 0", padding: "16px 16px 100px",
    maxHeight: "60vh", overflowY: "auto", zIndex: 50,
    boxShadow: "0 -8px 40px #0003", animation: "slideUp .25s ease",
  };
  const pBtn = (bg2, outline = false) => ({
    background: outline ? "transparent" : bg2,
    border: `2px solid ${outline ? border : bg2}`,
    color: outline ? tx : "#fff",
    padding: "10px 18px", borderRadius: 12,
    fontSize: 13, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit", whiteSpace: "nowrap",
  });
  const navBtn = (disabled) => ({
    background: disabled ? "transparent" : acc,
    border: `2px solid ${disabled ? border : acc}`,
    color: disabled ? muted : "#fff",
    padding: "8px 16px", borderRadius: 10, fontSize: 12,
    fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1, fontFamily: "inherit",
  });

  // ════════════════ LIBRARY SCREEN ════════════════════════════════════════════
  if (screen === "library") return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh",
      background: bg, color: tx, fontFamily: "'Georgia','Book Antiqua',serif",
      overflow: "hidden" }}>

      {/* Permission popup */}
      {showPermPopup && storagePermission === "ask" && (
        <div style={{ position: "fixed", inset: 0, background: "#0007",
          zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24 }}>
          <div style={{ background: surface, borderRadius: 20, padding: 24,
            maxWidth: 340, width: "100%", boxShadow: "0 8px 48px #0005" }}>
            <div style={{ fontSize: 36, marginBottom: 12, textAlign: "center" }}>📂</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: acc,
              marginBottom: 8, textAlign: "center" }}>
              Storage Access
            </div>
            <div style={{ fontSize: 14, color: muted, lineHeight: 1.7,
              marginBottom: 20, textAlign: "center" }}>
              Allow PDF Reader to scan your storage and find all PDF files automatically.
              Your files stay on your device.
            </div>
            <button onClick={handleGrantPermission}
              style={{ ...pBtn(acc), width: "100%", marginBottom: 10,
                padding: "13px", fontSize: 15, borderRadius: 14 }}>
              📂 Allow Storage Access
            </button>
            <button onClick={() => { setShowPermPopup(false); fileInputRef.current.click(); }}
              style={{ ...pBtn(acc, true), width: "100%", marginBottom: 10,
                padding: "12px", borderRadius: 14 }}>
              Pick PDFs Manually
            </button>
            <button onClick={handleDontAskAgain}
              style={{ background: "none", border: "none", width: "100%",
                color: muted, fontSize: 12, cursor: "pointer", padding: "8px",
                fontFamily: "inherit" }}>
              Don't ask again
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: surface, borderBottom: `1px solid ${border}`,
        padding: "14px 18px", display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0 }}>
        <span style={{ fontSize: 26 }}>📚</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: acc }}>My Library</div>
          <div style={{ fontSize: 11, color: muted }}>
            {library.length} book{library.length !== 1 ? "s" : ""}
          </div>
        </div>
        {scanning && <span style={{ fontSize: 12, color: acc }}>Scanning…</span>}
        <button onClick={() => setDark(!d)}
          style={{ background: "none", border: "none", fontSize: 20,
            cursor: "pointer", color: acc }}>
          {d ? "☀️" : "🌙"}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 12px 100px" }}>

        {library.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", minHeight: "70vh", gap: 16, textAlign: "center",
            padding: 24 }}>
            <div style={{ fontSize: 72 }}>📖</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: acc }}>No books yet</div>
            <div style={{ fontSize: 14, color: muted, maxWidth: 280, lineHeight: 1.8 }}>
              Tap the + button below to add your first PDF book
            </div>
          </div>
        ) : (
          <>
            {/* Recently Opened */}
            {recentList.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: muted,
                  textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>
                  Recently Opened
                </div>
                <div style={{ display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {recentList.slice(0, 3).map((book, i) => {
                    const c = coverColor(book.name);
                    return (
                      <div key={i} style={{ position: "relative" }}>
                        <div onClick={() => openBook(book)} style={{ cursor: "pointer" }}>
                          <div style={{ position: "relative", borderRadius: "4px 8px 8px 4px",
                            overflow: "hidden", marginBottom: 6,
                            boxShadow: "3px 4px 14px #0002",
                            aspectRatio: "2/3", background: c.bg }}>
                            <div style={{ position: "absolute", left: 0, top: 0,
                              bottom: 0, width: 10, background: c.spine }} />
                            <div style={{ position: "absolute", left: 10, right: 0,
                              top: 0, bottom: 0, display: "flex", flexDirection: "column",
                              alignItems: "center", justifyContent: "center",
                              padding: "10px 6px", gap: 6 }}>
                              <div style={{ fontSize: 22 }}>📄</div>
                              <div dir="auto" style={{ fontSize: 9, color: c.text,
                                textAlign: "center", fontWeight: 700, lineHeight: 1.3,
                                wordBreak: "break-word", display: "-webkit-box",
                                WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
                                overflow: "hidden" }}>
                                {book.name}
                              </div>
                            </div>
                          </div>
                          <div dir="auto" style={{ fontSize: 10, fontWeight: 700,
                            color: tx, lineHeight: 1.3, display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                            overflow: "hidden" }}>
                            {book.name}
                          </div>
                        </div>
                        {/* Remove from recent */}
                        <button onClick={() => removeFromRecent(book.name)}
                          style={{ position: "absolute", top: 3, right: 3,
                            background: "#000a", border: "none", borderRadius: "50%",
                            width: 20, height: 20, cursor: "pointer", color: "#fff",
                            fontSize: 12, display: "flex", alignItems: "center",
                            justifyContent: "center", zIndex: 2 }}>
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Divider */}
            {recentList.length > 0 && (
              <div style={{ borderTop: `1px solid ${border}`, marginBottom: 16 }} />
            )}

            {/* All PDFs label */}
            <div style={{ fontSize: 13, fontWeight: 800, color: muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>
              All Books ({library.length})
            </div>

            {/* Book grid — 3 per row */}
            <div style={{ display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {library.map((book, i) => {
                const c = coverColor(book.name);
                const bms = (bookmarks[book.name] || []).length;
                const pg = lastRead[book.name];
                return (
                  <div key={i} style={{ position: "relative",
                    animation: `fadeIn .3s ease ${i * .03}s both` }}>
                    <div onClick={() => openBook(book)} style={{ cursor: "pointer" }}>
                      <div style={{ position: "relative",
                        borderRadius: "4px 8px 8px 4px", overflow: "hidden",
                        marginBottom: 6, boxShadow: "3px 5px 16px #0002",
                        aspectRatio: "2/3", background: c.bg,
                        transition: "transform .2s" }}
                        onMouseEnter={e => e.currentTarget.style.transform = "translateY(-3px)"}
                        onMouseLeave={e => e.currentTarget.style.transform = ""}>
                        <div style={{ position: "absolute", left: 0, top: 0,
                          bottom: 0, width: 10, background: c.spine }} />
                        <div style={{ position: "absolute", left: 10, right: 0,
                          top: 0, bottom: 0, display: "flex", flexDirection: "column",
                          alignItems: "center", justifyContent: "center",
                          padding: "10px 6px", gap: 6 }}>
                          <div style={{ fontSize: 22 }}>📄</div>
                          <div dir="auto" style={{ fontSize: 9, color: c.text,
                            textAlign: "center", fontWeight: 700, lineHeight: 1.3,
                            wordBreak: "break-word", display: "-webkit-box",
                            WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
                            overflow: "hidden" }}>
                            {book.name}
                          </div>
                        </div>
                        {pg && (
                          <div style={{ position: "absolute", bottom: 0,
                            left: 10, right: 0, height: 3, background: "#fff2" }}>
                            <div style={{ height: "100%", background: c.text,
                              width: `${Math.min(100, (pg / 100) * 100)}%` }} />
                          </div>
                        )}
                        {bms > 0 && (
                          <div style={{ position: "absolute", top: 4, right: 4,
                            background: "#000a", borderRadius: 6, padding: "1px 4px",
                            fontSize: 8, color: "#fff" }}>🔖{bms}</div>
                        )}
                      </div>
                      <div dir="auto" style={{ fontSize: 10, fontWeight: 700,
                        color: tx, lineHeight: 1.3, display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                        overflow: "hidden" }}>
                        {book.name}
                      </div>
                      {pg && <div style={{ fontSize: 9, color: acc }}>Pg {pg}</div>}
                    </div>
                    {/* Delete from library */}
                    <button onClick={() => {
                      if (window.confirm(`Remove "${book.name}"?`)) {
                        dbDeletePDF(book.name).catch(() => {});
                        setLibrary(prev => prev.filter(b => b.name !== book.name));
                        setRecentBooks(prev => prev.filter(n => n !== book.name));
                        showToast("Removed from library");
                      }
                    }} style={{ position: "absolute", top: 3, left: 13,
                      background: "#000a", border: "none", borderRadius: "50%",
                      width: 18, height: 18, cursor: "pointer", color: "#fff",
                      fontSize: 11, display: "flex", alignItems: "center",
                      justifyContent: "center" }}>×</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Floating + button — only show if no storage permission */}
      {storagePermission !== "granted" && (
        <button onClick={() => fileInputRef.current.click()}
          style={{ position: "fixed", bottom: 28, left: "50%",
            transform: "translateX(-50%)",
            width: 60, height: 60, borderRadius: "50%",
            background: acc, border: "none", cursor: "pointer",
            fontSize: 32, color: "#fff", fontWeight: 300,
            boxShadow: "0 6px 24px #0004",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 40, transition: "transform .15s" }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateX(-50%) scale(1.1)"}
          onMouseLeave={e => e.currentTarget.style.transform = "translateX(-50%)"}>
          +
        </button>
      )}

      <input ref={fileInputRef} type="file" accept=".pdf,application/pdf"
        multiple style={{ display: "none" }}
        onChange={e => handleFiles(e.target.files)} />

      {toast && <Toast toast={toast} acc={acc} surface={surface} tx={tx} border={border} />}
      <style>{CSS}</style>
    </div>
  );

  // ════════════════ READER SCREEN ═════════════════════════════════════════════
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh",
      background: bg, color: tx, fontFamily: "'Georgia','Book Antiqua',serif",
      overflow: "hidden" }}>

      {/* Drawer overlay */}
      {readerDrawerOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#0005",
          zIndex: 80 }} onClick={() => { setReaderDrawerOpen(false); setAllBookmarksView(false); }} />
      )}

      {/* ── Left Drawer ── */}
      <div style={{ position: "fixed", top: 0, left: 0, bottom: 0,
        width: 280, background: drawerBg, zIndex: 90,
        transform: readerDrawerOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform .25s ease",
        display: "flex", flexDirection: "column",
        boxShadow: readerDrawerOpen ? "4px 0 32px #0004" : "none" }}>

        {/* Drawer header */}
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${border}`,
          display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>📖</span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: acc,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentBook?.name}
          </div>
          <button onClick={() => setReaderDrawerOpen(false)}
            style={{ background: "none", border: "none", fontSize: 20,
              cursor: "pointer", color: muted }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>

          {/* All saved pages across all books */}
          {!allBookmarksView ? (
            <>
              {[
                { icon: "🔖", label: "Saved Pages", sub: `${bookBookmarks.length} saved`, action: () => { setActivePanel("saved"); setReaderDrawerOpen(false); } },
                { icon: "📚", label: "All Saved Pages", sub: `${allBookmarks.length} across all books`, action: () => setAllBookmarksView(true) },
                { icon: "🔢", label: "Go to Page", sub: `Current: ${currentPage} of ${numPages}`, action: () => { setActivePanel("goto"); setReaderDrawerOpen(false); } },
                { icon: "🔍", label: "Search in PDF", sub: "Full text search", action: () => { setActivePanel("search"); setReaderDrawerOpen(false); } },
                { icon: "✏️", label: "Notes", sub: `${Object.keys(bookNotes).length} note${Object.keys(bookNotes).length !== 1 ? "s" : ""} on this book`, action: () => { setActivePanel("notes"); setReaderDrawerOpen(false); } },
                { icon: "📑", label: "Table of Contents", sub: toc.length > 0 ? `${toc.length} sections` : "Not available", action: () => { setActivePanel("toc"); setReaderDrawerOpen(false); } },
              ].map((item, i) => (
                <div key={i}>
                  <div onClick={item.action}
                    style={{ display: "flex", alignItems: "center", gap: 14,
                      padding: "14px 18px", cursor: "pointer",
                      transition: "background .15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = accL}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ fontSize: 22, width: 32, textAlign: "center" }}>{item.icon}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: tx }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: muted }}>{item.sub}</div>
                    </div>
                  </div>
                  {i < 5 && <div style={{ borderTop: `1px solid ${border}`, margin: "0 18px" }} />}
                </div>
              ))}

              <div style={{ borderTop: `2px solid ${border}`, margin: "8px 0" }} />

              {/* Theme toggle in drawer */}
              <div onClick={() => setDark(!d)}
                style={{ display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 18px", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = accL}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ fontSize: 22, width: 32, textAlign: "center" }}>{d ? "☀️" : "🌙"}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: tx }}>
                    {d ? "Light Mode" : "Dark Mode"}
                  </div>
                  <div style={{ fontSize: 11, color: muted }}>Switch theme</div>
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${border}`, margin: "0 18px" }} />

              {/* Back to library */}
              <div onClick={() => { setScreen("library"); setPdfDoc(null); setReaderDrawerOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 18px", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = accL}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ fontSize: 22, width: 32, textAlign: "center" }}>🏠</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: tx }}>Back to Library</div>
                  <div style={{ fontSize: 11, color: muted }}>Close this book</div>
                </div>
              </div>
            </>
          ) : (
            /* All bookmarks view */
            <>
              <div style={{ padding: "12px 18px", display: "flex",
                alignItems: "center", gap: 10 }}>
                <button onClick={() => setAllBookmarksView(false)}
                  style={{ background: "none", border: "none",
                    cursor: "pointer", color: acc, fontSize: 14,
                    fontFamily: "inherit", fontWeight: 700 }}>
                  ← Back
                </button>
                <div style={{ fontSize: 14, fontWeight: 800, color: tx }}>
                  All Saved Pages ({allBookmarks.length})
                </div>
              </div>
              {allBookmarks.length === 0 ? (
                <div style={{ textAlign: "center", color: muted,
                  padding: "30px 20px", fontSize: 13 }}>
                  No saved pages across any book yet.
                </div>
              ) : allBookmarks.map((item, i) => (
                <div key={i}
                  onClick={() => {
                    const book = library.find(b => b.name === item.bookName);
                    if (book) {
                      openBook(book).then(() => {
                        setTimeout(() => goToPage(item.page), 500);
                      });
                    }
                    setAllBookmarksView(false); setReaderDrawerOpen(false);
                  }}
                  style={{ padding: "12px 18px", borderBottom: `1px solid ${border}`,
                    cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = accL}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: acc }}>
                    Page {item.page}
                  </div>
                  <div style={{ fontSize: 11, color: muted, marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.bookName}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Reading progress at bottom of drawer */}
        <div style={{ padding: "14px 18px", borderTop: `1px solid ${border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            fontSize: 11, color: muted, marginBottom: 6 }}>
            <span>Reading Progress</span>
            <span>{Math.round((currentPage / numPages) * 100)}%</span>
          </div>
          <div style={{ height: 6, background: border, borderRadius: 4 }}>
            <div style={{ height: "100%", background: acc, borderRadius: 4,
              width: `${(currentPage / numPages) * 100}%`,
              transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 11, color: muted, marginTop: 6, textAlign: "center" }}>
            Page {currentPage} of {numPages}
          </div>
        </div>
      </div>

      {/* ── Top bar ── */}
      <div style={{ background: surface, borderBottom: `1px solid ${border}`,
        padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0 }}>
        <button onClick={() => { setReaderDrawerOpen(true); setAllBookmarksView(false); }}
          style={{ background: "none", border: "none", fontSize: 22,
            cursor: "pointer", color: acc, padding: "4px 6px" }}>
          ☰
        </button>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: acc,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentBook?.name}
          </div>
          <div style={{ fontSize: 11, color: muted }}>
            Page {currentPage} of {numPages}
          </div>
        </div>
        {/* Zoom controls */}
        <button onClick={() => setZoom(z => Math.max(0.5, parseFloat((z - 0.2).toFixed(1))))}
          style={{ background: "none", border: "none", fontSize: 20,
            cursor: "pointer", color: muted, padding: "4px 6px" }}>−</button>
        <span style={{ fontSize: 11, color: muted, minWidth: 38, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoom(z => Math.min(4, parseFloat((z + 0.2).toFixed(1))))}
          style={{ background: "none", border: "none", fontSize: 20,
            cursor: "pointer", color: muted, padding: "4px 6px" }}>+</button>
      </div>

      {/* ── Canvas ── */}
      <div ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ flex: 1, overflowY: "auto", overflowX: "auto",
          background: cvsBg, display: "flex",
          flexDirection: "column", alignItems: "center",
          padding: "12px 8px 130px",
          WebkitOverflowScrolling: "touch" }}
        onClick={() => activePanel && setActivePanel(null)}>

        {rendering && (
          <div style={{ position: "fixed", top: 58, left: "50%",
            transform: "translateX(-50%)", background: surface,
            color: acc, padding: "5px 14px", borderRadius: 20, fontSize: 11,
            border: `1px solid ${acc}`, zIndex: 30 }}>
            Rendering…
          </div>
        )}

        <div style={{ boxShadow: "0 4px 32px #0003", display: "inline-block",
          lineHeight: 0 }}>
          <canvas ref={canvasRef} style={{ display: "block" }} />
        </div>

        {bookNotes[currentPage] && (
          <div dir="auto" style={{ margin: "12px 8px 0",
            maxWidth: 600, width: "calc(100% - 16px)",
            background: surface, border: `1px solid ${acc}44`,
            borderRadius: 12, padding: "10px 14px",
            fontSize: 13, color: muted, fontStyle: "italic" }}>
            <span style={{ color: acc, fontWeight: 700, fontStyle: "normal" }}>
              ✏️ Note:&nbsp;
            </span>
            {bookNotes[currentPage]}
          </div>
        )}
      </div>

      {/* ── Bottom navigation ── */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0,
        background: surface, borderTop: `2px solid ${border}`,
        zIndex: 40, boxShadow: "0 -4px 20px #0002" }}>

        {/* Prev / page indicator / next */}
        <div style={{ display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "10px 14px 6px", gap: 8 }}>
          <button onClick={() => goToPage(1)}
            disabled={currentPage === 1} style={{ ...navBtn(currentPage === 1), padding: "6px 10px", fontSize: 11 }}>
            ⏮
          </button>
          <button onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1} style={navBtn(currentPage === 1)}>
            ◀ Prev
          </button>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: acc }}>
              {currentPage} / {numPages}
            </div>
            <div style={{ height: 3, background: border, borderRadius: 3, marginTop: 3 }}>
              <div style={{ height: "100%", background: acc, borderRadius: 3,
                width: `${(currentPage / numPages) * 100}%`,
                transition: "width .3s" }} />
            </div>
          </div>
          <button onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === numPages} style={navBtn(currentPage === numPages)}>
            Next ▶
          </button>
          <button onClick={() => goToPage(numPages)}
            disabled={currentPage === numPages} style={{ ...navBtn(currentPage === numPages), padding: "6px 10px", fontSize: 11 }}>
            ⏭
          </button>
        </div>

        {/* Action tabs */}
        <div style={{ display: "flex", borderTop: `1px solid ${border}` }}>
          {[
            { key: "saved",  icon: "🔖", label: "Saved" },
            { key: "goto",   icon: "🔢", label: "Go to" },
            { key: "search", icon: "🔍", label: "Search" },
            { key: "notes",  icon: "✏️",  label: "Notes" },
            { key: "toc",    icon: "📑", label: "Contents" },
          ].map(item => (
            <button key={item.key}
              onClick={() => setActivePanel(activePanel === item.key ? null : item.key)}
              style={{ flex: 1, background: activePanel === item.key ? accL : "transparent",
                border: "none", cursor: "pointer", padding: "8px 2px",
                borderTop: activePanel === item.key ? `2px solid ${acc}` : "2px solid transparent",
                color: activePanel === item.key ? acc : muted,
                fontFamily: "inherit", transition: "all .15s" }}>
              <div style={{ fontSize: 15 }}>{item.icon}</div>
              <div style={{ fontSize: 9, fontWeight: 700, marginTop: 1 }}>{item.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Panels ── */}
      {activePanel && (
        <div style={panelStyle}>
          <div style={{ width: 40, height: 4, background: border, borderRadius: 4,
            margin: "0 auto 14px", cursor: "pointer" }}
            onClick={() => setActivePanel(null)} />

          {/* SAVED PAGES */}
          {activePanel === "saved" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: tx }}>🔖 Saved Pages</div>
                <button onClick={toggleBookmark}
                  style={{ ...pBtn(isBookmarked ? "#c0392b" : acc), padding: "7px 14px", fontSize: 12 }}>
                  {isBookmarked ? "Remove Page" : `Save Page ${currentPage}`}
                </button>
              </div>
              {bookBookmarks.length === 0 ? (
                <div style={{ textAlign: "center", color: muted, padding: "20px 0", fontSize: 14 }}>
                  No saved pages yet. Press "Save Page" to bookmark.
                </div>
              ) : bookBookmarks.map(pg => (
                <div key={pg}
                  style={{ display: "flex", alignItems: "center",
                    justifyContent: "space-between", padding: "12px 14px",
                    borderRadius: 12, marginBottom: 8, cursor: "pointer",
                    background: pg === currentPage ? accL : inputBg,
                    border: `1px solid ${pg === currentPage ? acc : border}` }}
                  onClick={() => { goToPage(pg); setActivePanel(null); }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700,
                      color: pg === currentPage ? acc : tx }}>
                      Page {pg}
                    </div>
                    {bookNotes[pg] && (
                      <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>✏️ Has a note</div>
                    )}
                  </div>
                  <button onClick={e => { e.stopPropagation();
                    setBookmarks(p => ({ ...p, [bookKey]: bookBookmarks.filter(b => b !== pg) })); }}
                    style={{ background: "none", border: "none",
                      cursor: "pointer", color: muted, fontSize: 20 }}>×</button>
                </div>
              ))}
            </>
          )}

          {/* GO TO PAGE */}
          {activePanel === "goto" && (
            <>
              <div style={{ fontSize: 16, fontWeight: 800, color: tx, marginBottom: 14 }}>
                🔢 Go to Page
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <input type="number" value={goInput}
                  onChange={e => setGoInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      goToPage(parseInt(goInput));
                      setGoInput(""); setActivePanel(null);
                    }
                  }}
                  placeholder={`Enter page (1 – ${numPages})`}
                  min={1} max={numPages}
                  style={{ flex: 1, padding: "12px 14px", borderRadius: 12,
                    border: `2px solid ${border}`, background: inputBg,
                    color: tx, fontSize: 15, fontFamily: "inherit", outline: "none" }} />
                <button
                  onClick={() => { goToPage(parseInt(goInput)); setGoInput(""); setActivePanel(null); }}
                  style={{ ...pBtn(acc), padding: "12px 20px" }}>
                  Go
                </button>
              </div>
              <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>Quick jump:</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[1, Math.floor(numPages * 0.25), Math.floor(numPages * 0.5),
                  Math.floor(numPages * 0.75), numPages]
                  .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
                  .map(pg => (
                    <button key={pg}
                      onClick={() => { goToPage(pg); setActivePanel(null); }}
                      style={{ background: pg === currentPage ? acc : inputBg,
                        border: `1px solid ${pg === currentPage ? acc : border}`,
                        color: pg === currentPage ? "#fff" : tx,
                        padding: "8px 14px", borderRadius: 10, fontSize: 12,
                        cursor: "pointer", fontFamily: "inherit" }}>
                      {pg === 1 ? "First" : pg === numPages ? "Last" : `Page ${pg}`}
                    </button>
                  ))}
              </div>
            </>
          )}

          {/* SEARCH */}
          {activePanel === "search" && (
            <>
              <div style={{ fontSize: 16, fontWeight: 800, color: tx, marginBottom: 14 }}>
                🔍 Search in PDF
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runSearch()}
                  placeholder="Search entire PDF…" dir="auto"
                  style={{ flex: 1, padding: "12px 14px", borderRadius: 12,
                    border: `2px solid ${border}`, background: inputBg,
                    color: tx, fontSize: 14, fontFamily: "inherit", outline: "none" }} />
                <button onClick={runSearch} style={{ ...pBtn(acc), padding: "12px 18px" }}>
                  Search
                </button>
              </div>
              {searching && (
                <div style={{ textAlign: "center", color: muted, padding: 12 }}>
                  Searching all {numPages} pages…
                </div>
              )}
              {!searching && searchQuery && !searchResults.length && (
                <div style={{ textAlign: "center", color: muted, padding: 12 }}>
                  No results found for "{searchQuery}"
                </div>
              )}
              {searchResults.map((r, i) => (
                <div key={i}
                  onClick={() => { goToPage(r.page); setActivePanel(null); }}
                  style={{ padding: "12px 14px", borderRadius: 12, marginBottom: 8,
                    background: r.page === currentPage ? accL : inputBg,
                    border: `1px solid ${r.page === currentPage ? acc : border}`,
                    cursor: "pointer" }}>
                  <div style={{ fontSize: 13, fontWeight: 700,
                    color: r.page === currentPage ? acc : tx, marginBottom: 4 }}>
                    Page {r.page}
                  </div>
                  {r.snippets.map((s, j) => (
                    <div key={j} dir="auto"
                      style={{ fontSize: 11, color: muted, lineHeight: 1.5 }}>
                      …{s.trim()}…
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

          {/* NOTES */}
          {activePanel === "notes" && (
            <>
              <div style={{ fontSize: 16, fontWeight: 800, color: tx, marginBottom: 8 }}>
                ✏️ Note for Page {currentPage}
              </div>
              <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)}
                dir="auto" placeholder="Write your note here…"
                style={{ width: "100%", minHeight: 100, padding: 12,
                  borderRadius: 12, border: `2px solid ${border}`,
                  background: inputBg, color: tx, fontSize: 14,
                  fontFamily: "inherit", resize: "vertical",
                  boxSizing: "border-box", outline: "none",
                  lineHeight: 1.6, marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <button onClick={saveNote} style={{ ...pBtn(acc), flex: 1 }}>
                  Save Note
                </button>
                {bookNotes[currentPage] && (
                  <button onClick={() => {
                    setNoteInput("");
                    const u = { ...bookNotes };
                    delete u[currentPage];
                    setNotes(p => ({ ...p, [bookKey]: u }));
                    showToast("Note deleted");
                  }} style={{ ...pBtn(acc, true), flex: 1 }}>
                    Delete
                  </button>
                )}
              </div>
              {Object.keys(bookNotes).length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: muted, fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
                    All Notes in This Book
                  </div>
                  {Object.entries(bookNotes).sort(([a], [b]) => Number(a) - Number(b)).map(([pg, note]) => (
                    <div key={pg}
                      onClick={() => { goToPage(Number(pg)); setActivePanel(null); }}
                      style={{ padding: "10px 12px", borderRadius: 10, marginBottom: 6,
                        cursor: "pointer",
                        background: Number(pg) === currentPage ? accL : inputBg,
                        border: `1px solid ${Number(pg) === currentPage ? acc : border}` }}>
                      <div style={{ fontSize: 12, color: acc, fontWeight: 700 }}>
                        Page {pg}
                      </div>
                      <div dir="auto" style={{ fontSize: 12, color: muted, marginTop: 2,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {note}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* TABLE OF CONTENTS */}
          {activePanel === "toc" && (
            <>
              <div style={{ fontSize: 16, fontWeight: 800, color: tx, marginBottom: 14 }}>
                📑 Table of Contents
              </div>
              {toc.length === 0 ? (
                <div style={{ textAlign: "center", color: muted,
                  padding: "20px 0", fontSize: 14 }}>
                  This PDF has no table of contents.
                </div>
              ) : toc.map((item, i) => (
                <div key={i} dir="auto"
                  onClick={() => navigateToc(item)}
                  style={{ padding: "10px 12px",
                    paddingLeft: 12 + item.depth * 16,
                    borderRadius: 10, cursor: "pointer", marginBottom: 4,
                    fontSize: item.depth === 0 ? 14 : 12,
                    fontWeight: item.depth === 0 ? 700 : 400,
                    color: item.depth === 0 ? acc : tx,
                    borderLeft: item.depth > 0 ? `2px solid ${border}` : "none",
                    transition: "background .15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = accL}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {item.title}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {toast && <Toast toast={toast} acc={acc} surface={surface} tx={tx} border={border} />}
      <style>{CSS}</style>
    </div>
  );
}

function Toast({ toast, acc, surface, tx, border }) {
  return (
    <div style={{ position: "fixed", bottom: 120, left: "50%",
      transform: "translateX(-50%)",
      background: toast.type === "success" ? acc : surface,
      color: toast.type === "success" ? "#fff" : tx,
      padding: "10px 22px", borderRadius: 24, fontSize: 13,
      boxShadow: "0 4px 28px #0004", border: `1px solid ${border}`,
      zIndex: 500, whiteSpace: "nowrap", animation: "fadeUp .2s ease" }}>
      {toast.msg}
    </div>
  );
}

const CSS = `
  @keyframes fadeUp {
    from{opacity:0;transform:translateX(-50%) translateY(10px)}
    to{opacity:1;transform:translateX(-50%) translateY(0)}
  }
  @keyframes slideUp {
    from{transform:translateY(100%)}
    to{transform:translateY(0)}
  }
  @keyframes fadeIn {
    from{opacity:0;transform:translateY(6px)}
    to{opacity:1;transform:translateY(0)}
  }
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#8886;border-radius:4px}
  input::-webkit-inner-spin-button{opacity:.5}
  *{box-sizing:border-box}
  input:focus,textarea:focus{outline:none}
`;
