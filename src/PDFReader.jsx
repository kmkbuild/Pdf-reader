import { useState, useEffect, useRef, useCallback } from "react";

// ── PDF.js ──────────────────────────────────────────────────────────────────
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

// ── UI Strings ───────────────────────────────────────────────────────────────
const T = {
  en:{ dir:"ltr",name:"English",flag:"🇬🇧",
    library:"My Library", scanFolder:"Scan Folder", addPDF:"Add PDF",
    scanHint:"Grant access to a folder and we'll find all PDFs inside.",
    permTitle:"Storage Access", permBody:"Allow access to your folder to scan for PDF books.",
    grantAccess:"Grant Folder Access", noPDFs:"No PDFs found in that folder.",
    scanning:"Scanning for PDFs…", books:"books", lastRead:"Last read",
    openPDF:"Open", openNew:"Open New", back:"← Library",
    page:"Page",of:"of",prev:"Prev",next:"Next",
    savePage:"Save Page",saved:"Saved ✓",
    bookmarks:"Saved",toc:"Contents",pages:"Pages",search:"Search",notes:"Notes",
    noBookmarks:"No saved pages yet.",noToc:"No table of contents.",
    noteFor:"Note — Page",saveNote:"Save Note",deleteNote:"Delete",
    noNotes:"No note yet.",searchIn:"Search in PDF…",
    goTo:"Go to page…",go:"Go",
    searching:"Searching pages…",noResults:"No results.",
    readingProgress:"Reading Progress",loading:"Loading…",rendering:"Rendering…",
    allNotes:"All Notes",theme:"Theme",language:"Language",
    sort:"Sort",sortName:"Name",sortDate:"Recent",
    searchLib:"Search library…",
  },
  ur:{ dir:"rtl",name:"اردو",flag:"🇵🇰",
    library:"میری لائبریری", scanFolder:"فولڈر اسکین کریں", addPDF:"PDF شامل کریں",
    scanHint:"فولڈر تک رسائی دیں اور ہم تمام PDF کتابیں تلاش کریں گے۔",
    permTitle:"اسٹوریج رسائی", permBody:"PDF کتابیں اسکین کرنے کے لیے فولڈر تک رسائی دیں۔",
    grantAccess:"فولڈر تک رسائی دیں", noPDFs:"اس فولڈر میں کوئی PDF نہیں ملی۔",
    scanning:"PDF تلاش ہو رہی ہے…", books:"کتابیں", lastRead:"آخری بار پڑھا",
    openPDF:"کھولیں",openNew:"نئی PDF",back:"← لائبریری",
    page:"صفحہ",of:"از",prev:"پچھلا",next:"اگلا",
    savePage:"محفوظ کریں",saved:"محفوظ ✓",
    bookmarks:"محفوظ",toc:"فہرست",pages:"صفحات",search:"تلاش",notes:"نوٹس",
    noBookmarks:"ابھی کوئی محفوظ صفحہ نہیں۔",noToc:"فہرست موجود نہیں۔",
    noteFor:"نوٹ — صفحہ",saveNote:"نوٹ محفوظ کریں",deleteNote:"حذف",
    noNotes:"ابھی کوئی نوٹ نہیں۔",searchIn:"PDF میں تلاش کریں…",
    goTo:"صفحہ نمبر…",go:"جائیں",
    searching:"تلاش ہو رہی ہے…",noResults:"کوئی نتیجہ نہیں۔",
    readingProgress:"پڑھنے کی پیشرفت",loading:"لوڈ ہو رہا ہے…",rendering:"رینڈر ہو رہا ہے…",
    allNotes:"تمام نوٹس",theme:"تھیم",language:"زبان",
    sort:"ترتیب",sortName:"نام",sortDate:"حالیہ",
    searchLib:"لائبریری میں تلاش کریں…",
  },
  hi:{ dir:"ltr",name:"हिन्दी",flag:"🇮🇳",
    library:"मेरी लाइब्रेरी", scanFolder:"फ़ोल्डर स्कैन करें", addPDF:"PDF जोड़ें",
    scanHint:"फ़ोल्डर तक पहुँच दें और हम सभी PDF ढूंढ लेंगे।",
    permTitle:"स्टोरेज एक्सेस", permBody:"PDF किताबें स्कैन करने के लिए फ़ोल्डर तक पहुँच दें।",
    grantAccess:"फ़ोल्डर एक्सेस दें", noPDFs:"उस फ़ोल्डर में कोई PDF नहीं मिली।",
    scanning:"PDF खोज रहे हैं…", books:"किताबें", lastRead:"अंतिम बार पढ़ा",
    openPDF:"खोलें",openNew:"नई PDF",back:"← लाइब्रेरी",
    page:"पृष्ठ",of:"का",prev:"पिछला",next:"अगला",
    savePage:"सहेजें",saved:"सहेजा ✓",
    bookmarks:"सहेजे",toc:"सामग्री",pages:"पृष्ठ",search:"खोज",notes:"नोट्स",
    noBookmarks:"कोई सहेजा पृष्ठ नहीं।",noToc:"कोई सामग्री सूची नहीं।",
    noteFor:"नोट — पृष्ठ",saveNote:"नोट सहेजें",deleteNote:"हटाएं",
    noNotes:"कोई नोट नहीं।",searchIn:"PDF में खोजें…",
    goTo:"पृष्ठ संख्या…",go:"जाएं",
    searching:"खोज रहे हैं…",noResults:"कोई परिणाम नहीं।",
    readingProgress:"पढ़ने की प्रगति",loading:"लोड हो रहा है…",rendering:"रेंडर हो रहा है…",
    allNotes:"सभी नोट्स",theme:"थीम",language:"भाषा",
    sort:"क्रम",sortName:"नाम",sortDate:"हाल का",
    searchLib:"लाइब्रेरी में खोजें…",
  },
  ar:{ dir:"rtl",name:"العربية",flag:"🇸🇦",
    library:"مكتبتي", scanFolder:"مسح المجلد", addPDF:"إضافة PDF",
    scanHint:"امنح الوصول إلى مجلد وسنجد جميع ملفات PDF.",
    permTitle:"الوصول إلى التخزين", permBody:"امنح الوصول إلى المجلد لمسح كتب PDF.",
    grantAccess:"منح وصول المجلد", noPDFs:"لم يتم العثور على PDF في هذا المجلد.",
    scanning:"جارٍ البحث عن PDF…", books:"كتب", lastRead:"آخر قراءة",
    openPDF:"فتح",openNew:"فتح جديد",back:"← المكتبة",
    page:"صفحة",of:"من",prev:"السابق",next:"التالي",
    savePage:"حفظ",saved:"محفوظ ✓",
    bookmarks:"المحفوظة",toc:"المحتويات",pages:"الصفحات",search:"بحث",notes:"ملاحظات",
    noBookmarks:"لا توجد صفحات محفوظة.",noToc:"لا يوجد جدول محتويات.",
    noteFor:"ملاحظة — صفحة",saveNote:"حفظ الملاحظة",deleteNote:"حذف",
    noNotes:"لا توجد ملاحظة.",searchIn:"ابحث في PDF…",
    goTo:"رقم الصفحة…",go:"اذهب",
    searching:"جارٍ البحث…",noResults:"لا توجد نتائج.",
    readingProgress:"تقدم القراءة",loading:"جارٍ التحميل…",rendering:"جارٍ التصيير…",
    allNotes:"كل الملاحظات",theme:"السمة",language:"اللغة",
    sort:"ترتيب",sortName:"الاسم",sortDate:"الأحدث",
    searchLib:"ابحث في المكتبة…",
  },
  fr:{ dir:"ltr",name:"Français",flag:"🇫🇷",
    library:"Ma Bibliothèque", scanFolder:"Scanner un dossier", addPDF:"Ajouter PDF",
    scanHint:"Accordez l'accès à un dossier et nous trouverons tous les PDF.",
    permTitle:"Accès au stockage", permBody:"Accordez l'accès au dossier pour scanner les livres PDF.",
    grantAccess:"Accorder l'accès", noPDFs:"Aucun PDF trouvé dans ce dossier.",
    scanning:"Recherche de PDFs…", books:"livres", lastRead:"Dernière lecture",
    openPDF:"Ouvrir",openNew:"Nouveau PDF",back:"← Bibliothèque",
    page:"Page",of:"sur",prev:"Préc.",next:"Suiv.",
    savePage:"Sauvegarder",saved:"Sauvegardé ✓",
    bookmarks:"Signets",toc:"Sommaire",pages:"Pages",search:"Recherche",notes:"Notes",
    noBookmarks:"Aucun signet.",noToc:"Pas de sommaire.",
    noteFor:"Note — Page",saveNote:"Sauvegarder",deleteNote:"Supprimer",
    noNotes:"Aucune note.",searchIn:"Rechercher dans le PDF…",
    goTo:"Numéro de page…",go:"Aller",
    searching:"Recherche…",noResults:"Aucun résultat.",
    readingProgress:"Progression",loading:"Chargement…",rendering:"Rendu…",
    allNotes:"Toutes les Notes",theme:"Thème",language:"Langue",
    sort:"Trier",sortName:"Nom",sortDate:"Récent",
    searchLib:"Rechercher dans la bibliothèque…",
  },
  zh:{ dir:"ltr",name:"中文",flag:"🇨🇳",
    library:"我的书库", scanFolder:"扫描文件夹", addPDF:"添加 PDF",
    scanHint:"授予文件夹访问权限，我们将找到所有 PDF 书籍。",
    permTitle:"存储访问", permBody:"授予文件夹访问权限以扫描 PDF 书籍。",
    grantAccess:"授予文件夹访问权限", noPDFs:"该文件夹中未找到 PDF。",
    scanning:"正在搜索 PDF…", books:"本书", lastRead:"最近阅读",
    openPDF:"打开",openNew:"新 PDF",back:"← 书库",
    page:"第",of:"页共",prev:"上一页",next:"下一页",
    savePage:"保存",saved:"已保存 ✓",
    bookmarks:"书签",toc:"目录",pages:"页面",search:"搜索",notes:"笔记",
    noBookmarks:"暂无书签。",noToc:"此 PDF 没有目录。",
    noteFor:"笔记 — 第",saveNote:"保存笔记",deleteNote:"删除",
    noNotes:"暂无笔记。",searchIn:"在 PDF 中搜索…",
    goTo:"跳转页面…",go:"跳转",
    searching:"搜索中…",noResults:"未找到结果。",
    readingProgress:"阅读进度",loading:"加载中…",rendering:"渲染中…",
    allNotes:"全部笔记",theme:"主题",language:"语言",
    sort:"排序",sortName:"名称",sortDate:"最近",
    searchLib:"搜索书库…",
  },
};

// ── Generate a soft cover color from filename ────────────────────────────────
function coverColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const hues = [14,30,48,190,220,260,340];
  const hue = hues[Math.abs(h) % hues.length];
  return { bg:`hsl(${hue},40%,30%)`, spine:`hsl(${hue},40%,22%)`, text:`hsl(${hue},20%,85%)` };
}

// ── Scan directory recursively for PDFs ──────────────────────────────────────
async function scanDir(dirHandle, depth = 0) {
  const pdfs = [];
  if (depth > 5) return pdfs;
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".pdf")) {
      const file = await handle.getFile();
      pdfs.push({ name: name.replace(/\.pdf$/i,""), file, size: file.size, modified: file.lastModified });
    } else if (handle.kind === "directory") {
      pdfs.push(...await scanDir(handle, depth + 1));
    }
  }
  return pdfs;
}

// ════════════════════════════════════════════════════════════════════════════
export default function PDFReader() {
  const [dark, setDark] = useState(true);
  const [lang, setLang] = useState("en");
  const [pdfjsReady, setPdfjsReady] = useState(false);
  const [screen, setScreen] = useState("library"); // "library" | "reader"
  const [library, setLibrary] = useState([]);       // scanned books
  const [scanning, setScanning] = useState(false);
  const [libSearch, setLibSearch] = useState("");
  const [libSort, setLibSort] = useState("name");   // "name"|"date"
  const [langMenu, setLangMenu] = useState(false);
  const [toast, setToast] = useState(null);
  const [permState, setPermState] = useState("idle"); // "idle"|"asking"|"denied"

  // ── Reader state ──
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.3);
  const [bookmarks, setBookmarks] = useState({});   // keyed by book name
  const [notes, setNotes] = useState({});           // keyed by book name
  const [noteInput, setNoteInput] = useState("");
  const [currentBook, setCurrentBook] = useState(null);
  const [toc, setToc] = useState([]);
  const [sidebarTab, setSidebarTab] = useState("bookmarks");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [goInput, setGoInput] = useState("");
  const [textCache, setTextCache] = useState({});
  const [lastRead, setLastRead] = useState({}); // { bookName: page }

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const fileInputRef = useRef(null);
  const t = T[lang];
  const isRTL = t.dir === "rtl";

  const arabicFont  = "'Noto Naskh Arabic','Scheherazade New',serif";
  const urduFont    = "'Noto Nastaliq Urdu',serif";
  const mainFont    = isRTL ? (lang==="ur" ? urduFont : arabicFont)
                            : "'Palatino Linotype','Book Antiqua',Georgia,serif";

  // ── Theme ──
  const d = dark;
  const bg      = d?"#0b0b0b":"#f0e9dc";
  const surface = d?"#141414":"#fffdf8";
  const sbar    = d?"#101010":"#faf6ef";
  const border  = d?"#222":"#ddd4c0";
  const tx      = d?"#dfd8c6":"#281e10";
  const muted   = d?"#4c4c4c":"#9e8f7a";
  const acc     = d?"#c9a96e":"#7a4f1e";
  const accBg   = d?"#c9a96e16":"#7a4f1e10";
  const inputBg = d?"#1b1b1b":"#f5f0e6";
  const cvsBg   = d?"#161414":"#cfc8b8";

  useEffect(() => {
    loadScript(PDFJS_URL).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      setPdfjsReady(true);
    });
  }, []);

  useEffect(() => {
    if (currentBook) setNoteInput(notes[currentBook.name]?.[currentPage] || "");
  }, [currentPage, currentBook]);

  const showToast = (msg, type="info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  // ── Scan folder ──────────────────────────────────────────────────────────
  const handleScanFolder = async () => {
    if (!("showDirectoryPicker" in window)) {
      showToast("Directory picker not supported. Use Add PDF instead.", "error");
      return;
    }
    setPermState("asking");
    try {
      const dirHandle = await window.showDirectoryPicker({ mode:"read" });
      setPermState("idle");
      setScanning(true);
      const found = await scanDir(dirHandle);
      setScanning(false);
      if (found.length === 0) { showToast(t.noPDFs); return; }
      // Merge with existing library (avoid duplicates by name)
      setLibrary(prev => {
        const names = new Set(prev.map(b => b.name));
        const newBooks = found.filter(b => !names.has(b.name));
        return [...prev, ...newBooks];
      });
      showToast(`Found ${found.length} ${t.books}`, "success");
    } catch (e) {
      setScanning(false);
      if (e?.name === "AbortError") setPermState("idle");
      else { setPermState("denied"); showToast("Access denied."); }
    }
  };

  // ── Add single PDF ───────────────────────────────────────────────────────
  const handleAddPDF = (files) => {
    if (!files?.length) return;
    const newBooks = Array.from(files)
      .filter(f => f.type === "application/pdf")
      .map(f => ({ name: f.name.replace(/\.pdf$/i,""), file: f, size: f.size, modified: f.lastModified }));
    setLibrary(prev => {
      const names = new Set(prev.map(b => b.name));
      return [...prev, ...newBooks.filter(b => !names.has(b.name))];
    });
    if (newBooks.length) showToast(`Added ${newBooks.length} book(s)`, "success");
  };

  // ── Open a book ──────────────────────────────────────────────────────────
  const openBook = async (book) => {
    if (!pdfjsReady) return;
    setCurrentBook(book);
    setCurrentPage(lastRead[book.name] || 1);
    setToc([]); setSearchResults([]); setSearchQuery(""); setTextCache({});
    setSidebarTab("bookmarks");
    const buf = await book.file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    setPdfDoc(doc); setNumPages(doc.numPages);
    try { const o = await doc.getOutline(); setToc(flattenOutline(o)); } catch { setToc([]); }
    setScreen("reader");
  };

  const flattenOutline = (items, depth=0) => {
    if (!items) return [];
    return items.flatMap(item => [
      { title: item.title, dest: item.dest, depth },
      ...flattenOutline(item.items, depth+1),
    ]);
  };

  // ── Render page ──────────────────────────────────────────────────────────
  const renderPage = useCallback(async (doc, pageNum, scale) => {
    if (!canvasRef.current || !doc) return;
    if (renderTaskRef.current) renderTaskRef.current.cancel();
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const vp = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.height = vp.height; canvas.width = vp.width;
      const task = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
      renderTaskRef.current = task;
      await task.promise;
    } catch (e) {
      if (e?.name !== "RenderingCancelledException") console.error(e);
    } finally { setRendering(false); }
  }, []);

  useEffect(() => { if (pdfDoc) renderPage(pdfDoc, currentPage, zoom); }, [pdfDoc, currentPage, zoom, renderPage]);

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
    } catch {}
  };

  // ── Bookmarks (per book) ─────────────────────────────────────────────────
  const bookKey = currentBook?.name || "";
  const bookBookmarks = bookmarks[bookKey] || [];
  const toggleBookmark = () => {
    if (!pdfDoc) return;
    const bms = bookBookmarks;
    if (bms.includes(currentPage)) {
      setBookmarks(prev => ({ ...prev, [bookKey]: bms.filter(b => b !== currentPage) }));
    } else {
      setBookmarks(prev => ({ ...prev, [bookKey]: [...bms, currentPage].sort((a,b)=>a-b) }));
      showToast(`${t.savePage} ${currentPage}`, "success");
    }
  };

  // ── Notes (per book per page) ─────────────────────────────────────────────
  const bookNotes = notes[bookKey] || {};
  const saveNote = () => {
    const updated = { ...bookNotes };
    if (!noteInput.trim()) delete updated[currentPage];
    else updated[currentPage] = noteInput;
    setNotes(prev => ({ ...prev, [bookKey]: updated }));
    showToast(noteInput.trim() ? t.saveNote+" ✓" : "Note deleted", "success");
  };

  // ── Full-text search ─────────────────────────────────────────────────────
  const getPageText = async (doc, pageNum) => {
    if (textCache[pageNum]) return textCache[pageNum];
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items.map(i => i.str).join(" ");
    setTextCache(prev => ({ ...prev, [pageNum]: text }));
    return text;
  };

  const runSearch = async () => {
    if (!pdfDoc || !searchQuery.trim()) return;
    setSearching(true); setSearchResults([]); setSidebarTab("search");
    const q = searchQuery.trim().toLowerCase();
    const results = [];
    for (let p = 1; p <= numPages; p++) {
      try {
        const text = await getPageText(pdfDoc, p);
        const lower = text.toLowerCase();
        let idx = lower.indexOf(q);
        const snippets = [];
        while (idx !== -1 && snippets.length < 3) {
          snippets.push(text.slice(Math.max(0,idx-40), Math.min(text.length,idx+q.length+40)));
          idx = lower.indexOf(q, idx+1);
        }
        if (snippets.length) results.push({ page:p, snippets, count:snippets.length });
      } catch {}
    }
    setSearchResults(results); setSearching(false);
    if (!results.length) showToast(t.noResults);
    else showToast(`${results.reduce((a,r)=>a+r.count,0)} results on ${results.length} pages`, "success");
  };

  // ── Filtered library ─────────────────────────────────────────────────────
  const filteredLib = library
    .filter(b => b.name.toLowerCase().includes(libSearch.toLowerCase()))
    .sort((a,b) => libSort==="name"
      ? a.name.localeCompare(b.name)
      : (b.modified||0) - (a.modified||0));

  // ── Style helpers ─────────────────────────────────────────────────────────
  const ins = (extra={}) => ({
    flex:1, padding:"6px 10px", borderRadius:8,
    border:`1px solid ${border}`, background:inputBg,
    color:tx, fontFamily:"inherit", fontSize:12, outline:"none", ...extra,
  });
  const pBtn = (bg2, outline=false) => ({
    background: outline?"transparent":bg2,
    border: outline?`1px solid ${border}`:"none",
    cursor:"pointer", color: outline?muted:"#fff",
    padding:"7px 14px", borderRadius:20,
    fontSize:12, fontFamily:"inherit", fontWeight:700,
    letterSpacing:".03em", whiteSpace:"nowrap", transition:"opacity .15s",
  });
  const iBtn = (col) => ({
    background:"none", border:"none", cursor:"pointer",
    fontSize:16, padding:"4px 7px", borderRadius:7, color:col, lineHeight:1,
  });
  const nBtn = (col, dis) => ({
    background:"none", border:`1px solid ${dis?"#3335":col}`,
    cursor:dis?"not-allowed":"pointer",
    color:dis?"#454545":col,
    padding:"5px 12px", borderRadius:20,
    fontSize:11, fontFamily:"inherit", fontWeight:600,
    opacity:dis?.4:1, transition:"opacity .15s",
  });

  const TABS = [
    {key:"bookmarks",icon:"🔖",label:t.bookmarks},
    {key:"toc",icon:"📑",label:t.toc},
    {key:"pages",icon:"📄",label:t.pages},
    {key:"search",icon:"🔍",label:t.search},
    {key:"notes",icon:"✏️",label:t.notes},
  ];

  // ════════════════ LIBRARY SCREEN ══════════════════════════════════════════
  const LibraryScreen = () => (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:bg, color:tx, fontFamily:mainFont }} dir={t.dir}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 20px",
        background:surface, borderBottom:`1px solid ${border}`, flexWrap:"wrap" }}>
        <span style={{ fontSize:22 }}>📚</span>
        <span style={{ fontWeight:800, fontSize:18, color:acc, flex:1, letterSpacing:".02em" }}>
          {t.library}
        </span>

        {/* Lang menu */}
        <div style={{ position:"relative" }} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setLangMenu(!langMenu)} style={{ ...pBtn(muted,true), fontSize:11, padding:"5px 10px" }}>
            🌐 {t.name}
          </button>
          {langMenu && (
            <div style={{ position:"absolute", top:"calc(100% + 6px)", [isRTL?"left":"right"]:0,
              background:surface, border:`1px solid ${border}`, borderRadius:12,
              overflow:"hidden", zIndex:200, boxShadow:"0 10px 40px #0005", minWidth:150 }}>
              {Object.entries(T).map(([k,v]) => (
                <div key={k} dir={v.dir} onClick={()=>{setLang(k);setLangMenu(false);}}
                  style={{ padding:"9px 14px", cursor:"pointer", fontSize:13,
                    background:lang===k?accBg:"transparent", color:lang===k?acc:tx,
                    fontFamily:k==="ur"?urduFont:k==="ar"?arabicFont:"inherit",
                    transition:"background .15s" }}>
                  {v.flag} {v.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={()=>setDark(!d)} style={iBtn(acc)}>{d?"☀️":"🌙"}</button>
        <button onClick={handleScanFolder} style={pBtn(acc)} disabled={scanning}>
          {scanning ? t.scanning : `📂 ${t.scanFolder}`}
        </button>
        <button onClick={()=>fileInputRef.current.click()} style={pBtn(acc,true)}>
          + {t.addPDF}
        </button>
        <input ref={fileInputRef} type="file" accept="application/pdf" multiple
          style={{ display:"none" }} onChange={e=>handleAddPDF(e.target.files)} />
      </div>

      {/* Library body */}
      <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
        {library.length === 0 ? (
          /* ── Permission / empty state ── */
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", minHeight:"70vh", gap:20, textAlign:"center" }}>
            <div style={{ fontSize:80 }}>📁</div>
            <div style={{ fontSize:22, fontWeight:700, color:acc }}>{t.permTitle}</div>
            <div style={{ fontSize:14, color:muted, maxWidth:340, lineHeight:1.8 }}>{t.permBody}</div>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", justifyContent:"center" }}>
              <button onClick={handleScanFolder} style={{ ...pBtn(acc), padding:"12px 28px", fontSize:14 }}>
                📂 {t.grantAccess}
              </button>
              <button onClick={()=>fileInputRef.current.click()} style={{ ...pBtn(acc,true), padding:"12px 28px", fontSize:14 }}>
                + {t.addPDF}
              </button>
            </div>
            <div style={{ fontSize:12, color:muted, maxWidth:360, lineHeight:1.7, marginTop:4 }}>
              {t.scanHint}
            </div>
            {/* Supported languages badge row */}
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center", marginTop:8 }}>
              {Object.values(T).map(v=>(
                <span key={v.name} style={{ fontSize:11, color:muted, background:border,
                  padding:"3px 10px", borderRadius:20 }}>{v.flag} {v.name}</span>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Controls row */}
            <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
              <input value={libSearch} onChange={e=>setLibSearch(e.target.value)}
                placeholder={t.searchLib} dir="auto"
                style={{ ...ins(), flex:"1 1 200px" }} />
              <div style={{ display:"flex", gap:4 }}>
                <button onClick={()=>setLibSort("name")}
                  style={{ ...pBtn(libSort==="name"?acc:muted, libSort!=="name"), padding:"6px 12px", fontSize:11 }}>
                  {t.sortName}
                </button>
                <button onClick={()=>setLibSort("date")}
                  style={{ ...pBtn(libSort==="date"?acc:muted, libSort!=="date"), padding:"6px 12px", fontSize:11 }}>
                  {t.sortDate}
                </button>
              </div>
              <span style={{ fontSize:12, color:muted }}>
                {filteredLib.length} {t.books}
              </span>
              <button onClick={handleScanFolder} disabled={scanning}
                style={{ ...pBtn(acc,true), padding:"6px 12px", fontSize:11 }}>
                {scanning ? "…" : `📂 ${t.scanFolder}`}
              </button>
              <button onClick={()=>fileInputRef.current.click()}
                style={{ ...pBtn(acc,true), padding:"6px 12px", fontSize:11 }}>
                + {t.addPDF}
              </button>
            </div>

            {/* Book grid */}
            <div style={{ display:"grid",
              gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:20 }}>
              {filteredLib.map((book, i) => {
                const c = coverColor(book.name);
                const bms = (bookmarks[book.name]||[]).length;
                const hasNote = Object.keys(notes[book.name]||{}).length;
                const pg = lastRead[book.name];
                return (
                  <div key={i} onClick={()=>openBook(book)}
                    style={{ cursor:"pointer", animation:`fadeIn .3s ease ${i*.04}s both` }}>
                    {/* Book cover */}
                    <div style={{ position:"relative", borderRadius:"4px 8px 8px 4px",
                      overflow:"hidden", marginBottom:10,
                      boxShadow: d
                        ? "4px 6px 20px #000a, -1px 0 0 #fff1"
                        : "4px 6px 20px #0003, -1px 0 0 #fff8",
                      aspectRatio:"2/3", background:c.bg,
                      transition:"transform .2s, box-shadow .2s" }}
                      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-4px) scale(1.02)";e.currentTarget.style.boxShadow=d?"6px 12px 32px #000c":"6px 12px 32px #0005";}}
                      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}
                    >
                      {/* Spine */}
                      <div style={{ position:"absolute", left:0, top:0, bottom:0, width:14,
                        background:c.spine, boxShadow:"inset -2px 0 4px #0003" }} />
                      {/* Cover content */}
                      <div style={{ position:"absolute", left:14, right:0, top:0, bottom:0,
                        display:"flex", flexDirection:"column", alignItems:"center",
                        justifyContent:"center", padding:"16px 12px", gap:10 }}>
                        <div style={{ fontSize:32 }}>📄</div>
                        <div dir="auto" style={{ fontSize:11, color:c.text, textAlign:"center",
                          fontWeight:700, lineHeight:1.4, wordBreak:"break-word",
                          display:"-webkit-box", WebkitLineClamp:4,
                          WebkitBoxOrient:"vertical", overflow:"hidden" }}>
                          {book.name}
                        </div>
                      </div>
                      {/* Progress strip */}
                      {pg && numPages > 0 && (
                        <div style={{ position:"absolute", bottom:0, left:14, right:0, height:3,
                          background:"#fff2" }}>
                          <div style={{ height:"100%", background:c.text, opacity:.8,
                            width:`${Math.min(100,(pg/Math.max(1,numPages))*100)}%` }} />
                        </div>
                      )}
                      {/* Badge */}
                      {(bms>0||hasNote>0) && (
                        <div style={{ position:"absolute", top:6, right:6,
                          background:"#000a", borderRadius:10, padding:"2px 6px",
                          fontSize:9, color:"#fff" }}>
                          {bms>0&&`🔖${bms}`}{bms>0&&hasNote>0&&" "}{hasNote>0&&`✏️${hasNote}`}
                        </div>
                      )}
                    </div>
                    {/* Title + meta */}
                    <div dir="auto" style={{ fontSize:12, fontWeight:600, color:tx,
                      lineHeight:1.4, marginBottom:3, wordBreak:"break-word",
                      display:"-webkit-box", WebkitLineClamp:2,
                      WebkitBoxOrient:"vertical", overflow:"hidden" }}>
                      {book.name}
                    </div>
                    {pg && (
                      <div style={{ fontSize:10, color:muted }}>
                        {t.page} {pg}
                      </div>
                    )}
                    <div style={{ fontSize:10, color:muted }}>
                      {(book.size/1024/1024).toFixed(1)} MB
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} acc={acc} surface={surface} tx={tx} border={border} />}

      <style>{globalStyle(acc, muted, mainFont, urduFont, arabicFont)}</style>
    </div>
  );

  // ════════════════ READER SCREEN ════════════════════════════════════════════
  const ReaderScreen = () => {
    const isBookmarked = bookBookmarks.includes(currentPage);
    return (
      <div dir={t.dir} style={{ display:"flex", flexDirection:"column", height:"100vh",
        background:bg, color:tx, fontFamily:mainFont, overflow:"hidden" }}>

        {/* ── Top bar ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 14px",
          background:surface, borderBottom:`1px solid ${border}`, flexShrink:0, zIndex:20, flexWrap:"wrap" }}>
          <button onClick={()=>{setScreen("library");setPdfDoc(null);}} style={{ ...iBtn(acc), fontSize:13 }}>
            {t.back}
          </button>
          <div style={{ width:1, height:18, background:border }} />
          <button onClick={()=>setSidebarOpen(!sidebarOpen)} style={iBtn(muted)}>☰</button>
          <span style={{ fontSize:13, fontWeight:700, color:acc, flex:1,
            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:220 }}>
            {currentBook?.name}
          </span>

          {/* Search bar */}
          <div style={{ display:"flex", gap:6, flex:"1 1 160px", maxWidth:260 }}>
            <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&runSearch()}
              placeholder={t.searchIn} dir="auto"
              style={ins({ fontSize:11 })} />
            <button onClick={runSearch} style={pBtn(acc)}>🔍</button>
          </div>

          {/* Zoom */}
          <div style={{ display:"flex", gap:3, alignItems:"center" }}>
            <button onClick={()=>setZoom(z=>Math.max(.4,+(z-.2).toFixed(1)))} style={iBtn(muted)}>−</button>
            <span style={{ fontSize:10, color:muted, minWidth:32, textAlign:"center" }}>{Math.round(zoom*100)}%</span>
            <button onClick={()=>setZoom(z=>Math.min(3,+(z+.2).toFixed(1)))} style={iBtn(muted)}>+</button>
          </div>

          <button onClick={()=>setDark(!d)} style={iBtn(acc)}>{d?"☀️":"🌙"}</button>
        </div>

        {/* ── Body ── */}
        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

          {/* Sidebar */}
          {sidebarOpen && (
            <div style={{ width:224, background:sbar, flexShrink:0, display:"flex",
              flexDirection:"column",
              borderRight:isRTL?"none":`1px solid ${border}`,
              borderLeft:isRTL?`1px solid ${border}`:"none" }}>

              {/* Tab strip */}
              <div style={{ display:"flex", borderBottom:`1px solid ${border}`, overflowX:"auto", scrollbarWidth:"none" }}>
                {TABS.map(tab=>(
                  <button key={tab.key} onClick={()=>setSidebarTab(tab.key)} title={tab.label}
                    style={{ flex:"0 0 auto", minWidth:40, padding:"10px 6px", border:"none",
                      cursor:"pointer", background:sidebarTab===tab.key?accBg:"transparent",
                      color:sidebarTab===tab.key?acc:muted, fontSize:14,
                      borderBottom:sidebarTab===tab.key?`2px solid ${acc}`:"2px solid transparent",
                      transition:"all .15s" }}>
                    {tab.icon}
                  </button>
                ))}
              </div>

              <div style={{ flex:1, overflowY:"auto", padding:"10px 8px 6px" }}>

                {/* Bookmarks */}
                {sidebarTab==="bookmarks" && (
                  bookBookmarks.length===0
                    ? <SideMsg muted={muted}>{t.noBookmarks}</SideMsg>
                    : bookBookmarks.map(pg=>(
                      <SideRow key={pg} active={pg===currentPage} acc={acc} accBg={accBg} tx={tx} border={border}
                        onClick={()=>goToPage(pg)}>
                        <span style={{fontSize:12}}>📄 {t.page} {pg}</span>
                        <Xbtn muted={muted} onClick={e=>{e.stopPropagation();
                          setBookmarks(prev=>({...prev,[bookKey]:bookBookmarks.filter(b=>b!==pg)}));}} />
                      </SideRow>
                    ))
                )}

                {/* TOC */}
                {sidebarTab==="toc" && (
                  toc.length===0
                    ? <SideMsg muted={muted}>{t.noToc}</SideMsg>
                    : toc.map((item,i)=>(
                      <div key={i} dir="auto" onClick={()=>navigateToc(item)}
                        style={{ padding:"6px 8px",
                          paddingLeft:isRTL?8:8+item.depth*14,
                          paddingRight:isRTL?8+item.depth*14:8,
                          borderRadius:7, cursor:"pointer", marginBottom:2,
                          fontSize:item.depth===0?13:11,
                          fontWeight:item.depth===0?700:400,
                          color:item.depth===0?acc:tx,
                          transition:"background .15s" }}
                        onMouseEnter={e=>e.currentTarget.style.background=accBg}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        {item.title}
                      </div>
                    ))
                )}

                {/* Pages */}
                {sidebarTab==="pages" && (
                  <>
                    <form onSubmit={e=>{e.preventDefault();const n=parseInt(goInput);if(!isNaN(n)){goToPage(n);setGoInput("");}}}
                      style={{ display:"flex", gap:5, marginBottom:10 }}>
                      <input type="number" value={goInput} onChange={e=>setGoInput(e.target.value)}
                        placeholder={t.goTo} style={ins()} />
                      <button type="submit" style={pBtn(acc)}>{t.go}</button>
                    </form>
                    {Array.from({length:numPages},(_,i)=>i+1).map(pg=>(
                      <SideRow key={pg} active={pg===currentPage} acc={acc} accBg={accBg} tx={tx} border={border}
                        onClick={()=>goToPage(pg)}>
                        <span style={{fontSize:11}}>
                          {bookBookmarks.includes(pg)&&<span style={{marginRight:3}}>🔖</span>}
                          {bookNotes[pg]&&<span style={{marginRight:3}}>✏️</span>}
                          {t.page} {pg}
                        </span>
                      </SideRow>
                    ))}
                  </>
                )}

                {/* Search */}
                {sidebarTab==="search" && (
                  <>
                    <div style={{ display:"flex", gap:5, marginBottom:10 }}>
                      <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                        onKeyDown={e=>e.key==="Enter"&&runSearch()}
                        placeholder={t.searchIn} dir="auto" style={ins()} />
                      <button onClick={runSearch} style={pBtn(acc)}>🔍</button>
                    </div>
                    {searching && <SideMsg muted={muted}>{t.searching}</SideMsg>}
                    {!searching && searchQuery && searchResults.length===0 && <SideMsg muted={muted}>{t.noResults}</SideMsg>}
                    {searchResults.map((r,i)=>(
                      <div key={i} style={{ marginBottom:10 }}>
                        <div onClick={()=>goToPage(r.page)}
                          style={{ fontWeight:700, color:acc, cursor:"pointer", fontSize:12,
                            padding:"5px 8px", borderRadius:7, marginBottom:3,
                            background:r.page===currentPage?accBg:"transparent", transition:"background .15s" }}
                          onMouseEnter={e=>e.currentTarget.style.background=accBg}
                          onMouseLeave={e=>e.currentTarget.style.background=r.page===currentPage?accBg:"transparent"}>
                          📄 {t.page} {r.page} <span style={{fontWeight:400,color:muted}}>({r.count})</span>
                        </div>
                        {r.snippets.map((s,j)=>(
                          <div key={j} dir="auto" onClick={()=>goToPage(r.page)}
                            style={{ fontSize:10, color:muted, cursor:"pointer",
                              padding:"3px 8px", borderRadius:5, lineHeight:1.6,
                              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                            onMouseEnter={e=>e.currentTarget.style.background=accBg}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            …{s.trim()}…
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                )}

                {/* Notes */}
                {sidebarTab==="notes" && (
                  <>
                    <div style={{ fontSize:11, color:muted, marginBottom:6, fontWeight:600 }}>
                      ✏️ {t.noteFor} {currentPage}
                    </div>
                    <textarea value={noteInput} onChange={e=>setNoteInput(e.target.value)}
                      dir="auto" placeholder={t.noNotes}
                      style={{ width:"100%", minHeight:120, resize:"vertical",
                        background:inputBg, border:`1px solid ${border}`,
                        color:tx, borderRadius:8, padding:8, fontSize:12,
                        fontFamily:"inherit", boxSizing:"border-box",
                        outline:"none", lineHeight:1.7 }} />
                    <div style={{ display:"flex", gap:6, marginTop:6 }}>
                      <button onClick={saveNote} style={{...pBtn(acc),flex:1}}>{t.saveNote}</button>
                      {bookNotes[currentPage] && (
                        <button onClick={()=>{setNoteInput("");const u={...bookNotes};delete u[currentPage];
                          setNotes(prev=>({...prev,[bookKey]:u}));showToast("Deleted");}}
                          style={{...pBtn(muted,true),flex:1}}>{t.deleteNote}</button>
                      )}
                    </div>
                    {Object.keys(bookNotes).length>0 && (
                      <div style={{ marginTop:16, borderTop:`1px solid ${border}`, paddingTop:10 }}>
                        <div style={{ fontSize:10, color:muted, marginBottom:6, textTransform:"uppercase", letterSpacing:".06em" }}>
                          {t.allNotes}
                        </div>
                        {Object.entries(bookNotes).sort(([a],[b])=>Number(a)-Number(b)).map(([pg,note])=>(
                          <div key={pg} onClick={()=>goToPage(Number(pg))}
                            style={{ cursor:"pointer", marginBottom:7, padding:"6px 8px", borderRadius:7,
                              background:Number(pg)===currentPage?accBg:"transparent",
                              border:`1px solid ${Number(pg)===currentPage?acc:"transparent"}` }}>
                            <div style={{ fontSize:10, color:acc, fontWeight:700 }}>{t.page} {pg}</div>
                            <div dir="auto" style={{ fontSize:10, color:muted, marginTop:2,
                              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{note}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Progress */}
              <div style={{ padding:"10px 12px", borderTop:`1px solid ${border}`, flexShrink:0 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:muted, marginBottom:4 }}>
                  <span>{t.readingProgress}</span>
                  <span>{Math.round((currentPage/numPages)*100)}%</span>
                </div>
                <div style={{ height:4, borderRadius:4, background:border }}>
                  <div style={{ height:"100%", borderRadius:4, background:acc,
                    width:`${(currentPage/numPages)*100}%`, transition:"width .3s" }} />
                </div>
                <div style={{ fontSize:10, color:muted, marginTop:4, textAlign:"center" }}>
                  {t.page} {currentPage} {t.of} {numPages}
                </div>
              </div>
            </div>
          )}

          {/* Canvas area */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ flex:1, overflowY:"auto", overflowX:"auto",
              display:"flex", flexDirection:"column", alignItems:"center",
              padding:"24px 20px", background:cvsBg }}>
              {rendering && (
                <div style={{ position:"fixed", top:56, left:"50%", transform:"translateX(-50%)",
                  background:surface, color:acc, padding:"4px 14px",
                  borderRadius:20, fontSize:10, border:`1px solid ${acc}`, zIndex:30 }}>
                  {t.rendering}
                </div>
              )}
              <div style={{ boxShadow:d?"0 16px 80px #000b":"0 8px 48px #6442202a",
                borderRadius:3, overflow:"hidden", border:`1px solid ${border}` }}>
                <canvas ref={canvasRef} />
              </div>
              {bookNotes[currentPage] && (
                <div dir="auto" style={{ marginTop:14, maxWidth:600, width:"100%",
                  background:surface, border:`1px solid ${acc}44`, borderRadius:10,
                  padding:"10px 16px", fontSize:13, color:muted, fontStyle:"italic",
                  boxShadow:`0 2px 14px ${acc}22` }}>
                  <span style={{ color:acc, fontWeight:700, fontStyle:"normal" }}>
                    ✏️ {t.noteFor} {currentPage}: &nbsp;
                  </span>
                  {bookNotes[currentPage]}
                </div>
              )}
            </div>

            {/* Nav bar */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
              flexWrap:"wrap", gap:8, padding:"11px 16px",
              background:surface, borderTop:`1px solid ${border}`, flexShrink:0 }}>
              <button onClick={()=>goToPage(1)} disabled={currentPage===1} style={nBtn(acc,currentPage===1)}>⏮</button>
              <button onClick={()=>goToPage(currentPage-1)} disabled={currentPage===1} style={nBtn(acc,currentPage===1)}>
                ◀ {t.prev}
              </button>
              <form onSubmit={e=>{e.preventDefault();const n=parseInt(goInput);if(!isNaN(n)){goToPage(n);setGoInput("");}}}
                style={{ display:"flex", gap:5, alignItems:"center" }}>
                <input type="number" value={goInput} onChange={e=>setGoInput(e.target.value)}
                  placeholder={`${currentPage}`}
                  style={ins({ width:56, textAlign:"center", padding:"5px 6px" })} />
                <span style={{ fontSize:11, color:muted }}>{t.of} {numPages}</span>
                <button type="submit" style={pBtn(acc)}>{t.go}</button>
              </form>
              <button onClick={()=>goToPage(currentPage+1)} disabled={currentPage===numPages} style={nBtn(acc,currentPage===numPages)}>
                {t.next} ▶
              </button>
              <button onClick={()=>goToPage(numPages)} disabled={currentPage===numPages} style={nBtn(acc,currentPage===numPages)}>⏭</button>
              <div style={{ width:1, height:22, background:border, margin:"0 4px" }} />
              <button onClick={toggleBookmark} style={pBtn(isBookmarked?"#b85c1e":acc)}>
                🔖 {isBookmarked?t.saved:t.savePage}
              </button>
              <button onClick={()=>{setSidebarTab("notes");setSidebarOpen(true);}}
                style={pBtn(bookNotes[currentPage]?"#4a8c6a":muted, !bookNotes[currentPage])}>
                {bookNotes[currentPage]?"✏️ Edit Note":"✏️ Add Note"}
              </button>
            </div>
          </div>
        </div>

        {toast && <Toast msg={toast.msg} type={toast.type} acc={acc} surface={surface} tx={tx} border={border} />}
        <style>{globalStyle(acc, muted, mainFont, urduFont, arabicFont)}</style>
      </div>
    );
  };

  return screen === "library" ? <LibraryScreen /> : <ReaderScreen />;
}

// ── Shared subcomponents ──────────────────────────────────────────────────────
function SideMsg({ children, muted }) {
  return <p style={{ color:muted, fontSize:12, textAlign:"center", marginTop:20, lineHeight:1.7 }}>{children}</p>;
}
function SideRow({ children, active, acc, accBg, tx, border, onClick }) {
  return (
    <div onClick={onClick}
      style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"7px 10px", borderRadius:8, marginBottom:3, cursor:"pointer",
        background:active?accBg:"transparent",
        border:`1px solid ${active?acc:"transparent"}`,
        color:active?acc:tx, transition:"background .15s" }}
      onMouseEnter={e=>{if(!active)e.currentTarget.style.background=accBg+"88";}}
      onMouseLeave={e=>{if(!active)e.currentTarget.style.background="transparent";}}>
      {children}
    </div>
  );
}
function Xbtn({ onClick, muted }) {
  return <button onClick={onClick}
    style={{ background:"none", border:"none", cursor:"pointer", color:muted, fontSize:15, lineHeight:1, padding:"0 2px" }}>×</button>;
}
function Toast({ msg, type, acc, surface, tx, border }) {
  return (
    <div style={{ position:"fixed", bottom:72, left:"50%", transform:"translateX(-50%)",
      background:type==="success"?acc:surface, color:type==="success"?"#fff":tx,
      padding:"8px 22px", borderRadius:24, fontSize:13,
      boxShadow:"0 4px 28px #0004", border:`1px solid ${border}`,
      zIndex:300, whiteSpace:"nowrap", animation:"fadeUp .2s ease" }}>
      {msg}
    </div>
  );
}
function globalStyle(acc, muted, mainFont, urduFont, arabicFont) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&family=Scheherazade+New&display=swap');
    @keyframes fadeUp{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:${muted}55;border-radius:4px}
    input::-webkit-inner-spin-button{opacity:.5}
    *{box-sizing:border-box}
    textarea:focus,input:focus{border-color:${acc}!important;outline:none}
  `;
}
