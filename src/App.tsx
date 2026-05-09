import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Zap, 
  History, 
  Download, 
  Printer, 
  Copy, 
  Trash2, 
  Search, 
  Settings2, 
  Plus, 
  Moon, 
  Sun,
  Check,
  ChevronRight,
  Monitor,
  Smartphone,
  ExternalLink,
  FileText,
  Barcode as BarcodeIcon,
  QrCode,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JsBarcode from 'jsbarcode';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore';
import { cn } from './lib/utils';
import { BarcodeConfig, BarcodeHistoryItem, BarcodeFormat } from './types';
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User } from './lib/firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function PrintItem({ config, isMultiple, isPrint }: { config: BarcodeConfig, isMultiple?: boolean, isPrint?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (config.format !== 'QR' && ref.current) {
      try {
        // High density multipliers for print
        const multiplier = isPrint ? 2 : 1;
        
        JsBarcode(ref.current, config.value, {
          format: config.format as any,
          lineColor: '#000000',
          background: '#ffffff',
          width: Math.max(config.width * multiplier, isMultiple ? 2 : 3),
          height: Math.max(config.height * multiplier, isMultiple ? 60 : 100),
          margin: config.margin,
          displayValue: false, // We render the p tag manually for better control
          fontSize: config.fontSize,
          font: config.font,
          textAlign: config.textAlign,
          textPosition: config.textPosition,
          textMargin: config.textMargin
        });
      } catch (e) {
        console.warn('Print generation failed', e);
      }
    }
  }, [config, isMultiple, isPrint]);

  return <svg ref={ref} className="max-w-full"></svg>;
}

const INITIAL_CONFIG: BarcodeConfig = {
  value: `SP-${new Date().getFullYear()}`,
  format: 'CODE128',
  lineColor: '#000000',
  background: 'transparent',
  width: 2,
  height: 100,
  margin: 10,
  displayValue: true,
  fontSize: 16,
  font: 'monospace',
  textAlign: 'center',
  textPosition: 'bottom',
  textMargin: 4
};

export default function App() {
  const [config, setConfig] = useState<BarcodeConfig>(INITIAL_CONFIG);
  const [history, setHistory] = useState<BarcodeHistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminView, setIsAdminView] = useState(true);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [printCopies, setPrintCopies] = useState(1);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const barcodeRef = useRef<SVGSVGElement>(null);
  
  const ADMIN_EMAIL = "suhaeservicepoint@gmail.com";

  // Trigger print when processing is done
  useEffect(() => {
    if (isPrinting) {
      const originalTitle = document.title;
      const cleanValue = config.value.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
      document.title = `SP_Barcode_${cleanValue}`;

      const timer = setTimeout(() => {
        try {
          window.print();
          console.log('Print dialog triggered');
        } catch (err) {
          console.error('Print failed:', err);
          alert('Print command failed. Please try opening the app in a new tab.');
        } finally {
          setIsPrinting(false);
          setTimeout(() => {
            document.title = originalTitle;
          }, 1000);
        }
      }, 800); // More generous delay for many barcodes to render

      return () => clearTimeout(timer);
    }
  }, [isPrinting, config.value]);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAdmin(currentUser?.email === ADMIN_EMAIL);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // History sync with Firestore or Local fallback
  useEffect(() => {
    if (isAuthLoading) return;

    if (user) {
      // Load from Firestore
      const path = 'history';
      let q;
      
      if (isAdmin && isAdminView) {
        // Admin sees EVERYTHING
        q = query(
          collection(db, path),
          orderBy('createdAt', 'desc')
        );
      } else {
        // Normal user sees their own
        q = query(
          collection(db, path),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
      }

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const remoteHistory = snapshot.docs.map(doc => ({
          ...doc.data(),
          createdAt: (doc.data().createdAt as Timestamp)?.toMillis() || Date.now()
        } as BarcodeHistoryItem));
        setHistory(remoteHistory);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      });

      return () => unsubscribe();
    } else {
      // Local fallback
      const savedHistory = localStorage.getItem('sp_barcode_history');
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory));
        } catch (e) {
          console.error('Failed to load history', e);
        }
      }
    }
  }, [user, isAuthLoading]);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Login failed', error);
      if (error.code === 'auth/network-request-failed') {
        alert('Signin failed due to network restrictions. This usually happens when Firebase is blocked by an adblocker or restricted in an iframe. \n\nPlease try:\n1. Disabling adblockers\n2. Opening the app in a new tab using the "Open in new tab" icon at the top right.');
      } else {
        alert('Login failed: ' + error.message);
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setHistory([]); // Clear local state on logout
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  // Sync theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  // Generate barcode
  useEffect(() => {
    if (config.format !== 'QR') {
      const options = {
        format: config.format as any,
        lineColor: config.lineColor,
        background: config.background,
        width: config.width,
        height: config.height,
        margin: config.margin,
        displayValue: config.displayValue,
        fontSize: config.fontSize,
        font: config.font,
        textAlign: config.textAlign,
        textPosition: config.textPosition,
        textMargin: config.textMargin
      };

      try {
        if (barcodeRef.current) {
          JsBarcode(barcodeRef.current, config.value, options);
        }
      } catch (e) {
        console.warn('Barcode generation failed', e);
      }
    }
  }, [config]);

  const saveToHistory = useCallback(async () => {
    if (!config.value) return;
    
    // Check if duplicate anywhere in history
    const isDuplicate = history.some(item => 
      item.config.value === config.value && 
      item.config.format === config.format
    );
    if (isDuplicate) return;

    const id = Math.random().toString(36).substring(7);
    const newItem: BarcodeHistoryItem = {
      id,
      config: { ...config },
      createdAt: Date.now()
    };

    if (user) {
      // Save to Firestore
      const path = `history/${id}`;
      try {
        await setDoc(doc(db, 'history', id), {
          id,
          userId: user.uid,
          config: { ...config },
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    } else {
      // Save locally
      const newHistory = [newItem, ...history].slice(0, 50); 
      setHistory(newHistory);
      localStorage.setItem('sp_barcode_history', JSON.stringify(newHistory));
    }
  }, [config, history, user]);

  const deleteFromHistory = async (id: string) => {
    if (user) {
      const path = `history/${id}`;
      try {
        await deleteDoc(doc(db, 'history', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    } else {
      const newHistory = history.filter(item => item.id !== id);
      setHistory(newHistory);
      localStorage.setItem('sp_barcode_history', JSON.stringify(newHistory));
    }
  };

  const clearAllHistory = async () => {
    if (window.confirm('Clear all history?')) {
      if (user) {
        // Clearing all for a user in Firestore usually requires a batch or loop (rules-protected)
        // For simplicity, we'll suggest individual deletions or a batch delete if we had many docs.
        // Given Firestore's limitations on blanket deletes, we'll just clear local state for guest
        // but for logged in users, we tell them it's synced.
        alert('Historical data is securely stored in your account. Individual items can be removed.');
      } else {
        setHistory([]);
        localStorage.removeItem('sp_barcode_history');
      }
    }
  };

  const downloadBarcode = (type: 'png' | 'svg') => {
    // If QR, we handle it separately
    if (config.format === 'QR') {
      const qrSvg = document.getElementById('qr-preview-svg') as unknown as SVGSVGElement;
      if (!qrSvg) {
        alert('Barcode preview not ready. Please try again.');
        return;
      }

      // Create a temporary clone to upscale
      const svgClone = qrSvg.cloneNode(true) as SVGSVGElement;
      const size = type === 'png' ? 2000 : 800; // Increased size for high quality
      svgClone.setAttribute('width', size.toString());
      svgClone.setAttribute('height', size.toString());
      
      // Ensure xmlns is present for standalone SVG
      if (!svgClone.getAttribute('xmlns')) {
        svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      
      const svgData = new XMLSerializer().serializeToString(svgClone);
      
      if (type === 'svg') {
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `qr-${config.value || 'barcode'}.svg`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const img = new Image();
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        
        img.onload = () => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          try {
            const pngUrl = canvas.toDataURL('image/png', 1.0);
            const link = document.createElement('a');
            link.href = pngUrl;
            link.download = `qr-${config.value || 'barcode'}.png`;
            link.click();
          } catch (e) {
            console.error('PNG export failed', e);
            alert('Export failed. Try SVG format.');
          }
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          console.error('Image load failed for PNG conversion');
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
      return;
    }

    // Standard Barcode Download
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);
    
    const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    container.appendChild(tempSvg);

    try {
      JsBarcode(tempSvg, config.value || ' ', {
        format: config.format as any,
        lineColor: '#000000',
        background: '#ffffff',
        width: 3, // High density
        height: 120,
        margin: 10,
        displayValue: config.displayValue,
        fontSize: config.fontSize,
        font: config.font
      });

      // Ensure dimensions are explicitly set for serialization
      const bBox = tempSvg.getBBox();
      tempSvg.setAttribute('width', bBox.width.toString());
      tempSvg.setAttribute('height', bBox.height.toString());
      tempSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      
      const svgData = new XMLSerializer().serializeToString(tempSvg);

      if (type === 'svg') {
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `barcode-${config.value || 'barcode'}.svg`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const scale = 3;
        const canvas = document.createElement('canvas');
        canvas.width = bBox.width * scale;
        canvas.height = bBox.height * scale;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context failed');
        
        const img = new Image();
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        
        img.onload = () => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const pngUrl = canvas.toDataURL('image/png', 1.0);
          const link = document.createElement('a');
          link.href = pngUrl;
          link.download = `barcode-${config.value || 'barcode'}.png`;
          link.click();
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
    } catch (err) {
      console.error('Download failed', err);
      alert('Failed to generate file for download.');
    } finally {
      document.body.removeChild(container);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(config.value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handlePrint = () => {
    console.log('Initiating print flow for', printCopies, 'copies');
    window.focus();
    setIsPrinting(true);
  };

  const generatePDF = async () => {
    if (isGeneratingPDF) return;
    
    setIsGeneratingPDF(true);
    
    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth(); // 210mm
      const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm
      const margin = 10;
      const cols = 3;
      const rows = 5;
      const cellWidth = (pageWidth - (2 * margin)) / cols;
      const cellHeight = (pageHeight - (2 * margin)) / rows;

      // Temporary canvas for barcode generation
      const canvas = document.createElement('canvas');
      const scale = 4; // High resolution

      for (let i = 0; i < 15; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        
        const x = margin + (col * cellWidth);
        const y = margin + (row * cellHeight);

        // Draw individual labels onto the PDF
        // Labels have a small internal margin
        const labelPadding = 5;
        const drawWidth = cellWidth - (labelPadding * 2);
        const drawHeight = cellHeight - (labelPadding * 2);

        if (config.format === 'QR') {
          // For QR, we find the SVG and convert
          const qrSvg = document.getElementById('qr-preview-svg') as unknown as SVGSVGElement;
          if (qrSvg) {
            const svgData = new XMLSerializer().serializeToString(qrSvg);
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            
            await new Promise((resolve) => {
              const img = new Image();
              img.onload = () => {
                const qrSize = Math.min(drawWidth, drawHeight - 10);
                const qrX = x + (cellWidth - qrSize) / 2;
                const qrY = y + (cellHeight - qrSize - (config.displayValue ? 8 : 0)) / 2;
                pdf.addImage(img, 'PNG', qrX, qrY, qrSize, qrSize);
                URL.revokeObjectURL(url);
                resolve(null);
              };
              img.src = url;
            });
          }
        } else {
          // For Barcode, render directly to hidden canvas
          JsBarcode(canvas, config.value, {
            format: config.format as any,
            lineColor: '#000000',
            background: '#ffffff',
            width: 4,
            height: 100,
            displayValue: false,
            margin: 0
          });
          
          const imgData = canvas.toDataURL('image/png', 1.0);
          const bcWidth = drawWidth * 0.9;
          const bcHeight = bcWidth * (canvas.height / canvas.width);
          
          const bcX = x + (cellWidth - bcWidth) / 2;
          const bcY = y + (cellHeight - bcHeight - (config.displayValue ? 8 : 0)) / 2;
          
          pdf.addImage(imgData, 'PNG', bcX, bcY, bcWidth, bcHeight);
        }

        // Add text if needed
        if (config.displayValue) {
          pdf.setFont('courier', 'bold');
          pdf.setFontSize(10);
          pdf.setTextColor(0, 0, 0);
          const textY = y + cellHeight - labelPadding - 2;
          pdf.text(config.value, x + (cellWidth / 2), textY, { align: 'center' });
        }

        // Draw label border
        pdf.setDrawColor(226, 232, 240);
        pdf.rect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
      }

      pdf.save(`SP_Barcode_${config.value.substring(0, 20)}.pdf`);
      console.log('PDF Generated Successfully via direct jspdf method');
    } catch (err) {
      console.error('PDF Generation failed:', err);
      alert('Internal PDF Export failed. Try "Print" and select "Save as PDF".');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const filteredHistory = history.filter(item => 
    item.config.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.config.format.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isAuthLoading) {
    return (
      <div className="h-screen w-full bg-[#09090B] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">Enforcing Privacy...</p>
        </div>
      </div>
    );
  }

  if (!user || user.email !== ADMIN_EMAIL) {
    return (
      <div className="h-screen w-full bg-[#09090B] flex items-center justify-center p-6 bg-mesh">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full glass p-10 rounded-[2.5rem] flex flex-col items-center text-center space-y-8"
        >
          <div className="w-20 h-20 rounded-3xl bg-indigo-600/10 flex items-center justify-center border border-indigo-500/20 shadow-2xl shadow-indigo-500/10">
            <span className="text-4xl">🔐</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Private Workspace</h1>
            <p className="text-slate-400 text-sm leading-relaxed">
              This application is strictly restricted to its owner. <br />
              Please sign in with the authorized account.
            </p>
          </div>
          <button 
            onClick={login}
            className="w-full h-14 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl font-bold flex items-center justify-center gap-3 transition-all shadow-xl shadow-indigo-900/40 active:scale-[0.98]"
          >
            <LogIn size={20} />
            Authorize Access
          </button>
          {user && user.email !== ADMIN_EMAIL && (
            <div className="space-y-4 w-full">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs font-medium">
                Access Denied: Not authorized account.
              </div>
              <button onClick={logout} className="text-xs font-bold text-slate-500 hover:text-white transition-colors uppercase tracking-widest">
                Log Out
              </button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[#09090B] text-slate-200 flex overflow-hidden font-sans select-none relative">
      {/* Sidebar: History */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-80 bg-[#121214] border-r border-white/5 flex flex-col shrink-0 transition-transform duration-300 lg:relative lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <BarcodeIcon className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-glow">SP Barcode</h1>
            </div>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-2 hover:bg-white/5 rounded-lg text-slate-500"
            >
              <ChevronRight className="rotate-180" />
            </button>
          </div>
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search history..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-slate-600"
            />
            <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-500" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between px-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              {isAdminView ? "Global Archive" : "Your Archive"}
            </div>
            {isAdmin && (
              <button 
                onClick={() => setIsAdminView(!isAdminView)}
                className={cn(
                  "px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-all border",
                  isAdminView 
                    ? "bg-indigo-500/20 border-indigo-500 text-indigo-400" 
                    : "bg-white/5 border-white/10 text-slate-500"
                )}
              >
                {isAdminView ? "Admin Mode On" : "Admin Mode Off"}
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {filteredHistory.map((item: any) => (
              <motion.div 
                layout
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={() => setConfig(item.config)}
                className="p-3 bg-white/[0.03] rounded-lg border border-white/5 hover:border-white/10 cursor-pointer group transition-all"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-mono text-slate-400 truncate max-w-[140px] tracking-tight">{item.config.value}</span>
                  <span className="text-[9px] text-slate-600 shrink-0">{format(item.createdAt, 'HH:mm')}</span>
                </div>
                <div className="flex items-center justify-between">
                   <div className="flex gap-1.5 items-center">
                     <div className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[8px] uppercase font-bold text-slate-500">
                      {item.config.format}
                    </div>
                    {isAdminView && item.userId !== user?.uid && (
                      <div className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[8px] uppercase font-bold text-indigo-400/60">
                        System User
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFromHistory(item.id);
                    }}
                    className="p-1 hover:bg-red-500/20 text-red-500/40 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {filteredHistory.length === 0 && (
            <div className="py-12 text-center text-slate-600 italic text-xs">No entries yet.</div>
          )}
        </div>

        <div className="p-4 border-t border-white/5">
          <div className="space-y-4">
            {user ? (
              <div className="flex items-center gap-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-white/10" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
                    <UserIcon size={14} className="text-white" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{user.displayName}</p>
                  <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
                </div>
                <button onClick={logout} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors">
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button 
                onClick={login}
                className="w-full h-10 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/40 transition-all active:scale-[0.98]"
              >
                <LogIn size={14} />
                Sign in with Google
              </button>
            )}

            <div className="flex gap-2">
              <button 
                onClick={clearAllHistory}
                disabled={history.length === 0}
                className="flex-1 h-8 bg-white/5 rounded flex items-center justify-center text-[10px] uppercase font-bold text-slate-400 hover:bg-white/10 transition-colors disabled:opacity-30"
              >
                Clear All
              </button>
              <button 
                onClick={() => setIsDark(!isDark)}
                className="w-8 h-8 bg-white/5 rounded flex items-center justify-center text-slate-400 hover:bg-white/10 transition-colors"
              >
                {isDark ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Layout Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Main Container */}
      <main className="flex-1 flex flex-col overflow-hidden bg-mesh min-w-0">
        <header className="h-16 flex items-center justify-between px-6 lg:px-8 bg-[#09090B] border-b border-white/5 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 bg-white/5 rounded-lg text-slate-400 hover:text-white"
            >
              <History size={20} />
            </button>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] lg:text-xs font-medium text-slate-400 uppercase tracking-widest truncate max-w-[120px] lg:max-w-none">Engine Active</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={copyToClipboard}
              className="px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 rounded-lg transition-colors border border-white/10 flex items-center gap-2"
            >
              {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {isCopied ? 'Copied' : 'Copy String'}
            </button>
            <button 
              onClick={handlePrint}
              className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-lg transition-all shadow-lg shadow-indigo-900/20 border border-indigo-400/20"
            >
              Print Barcode
            </button>
          </div>
        </header>

        <div className="flex-1 p-8 lg:p-12 overflow-y-auto flex flex-col items-center">
          <div className="w-full max-w-2xl space-y-12">
            {/* Preview Box */}
            <div className="relative w-full min-h-[400px] bg-[#18181B] rounded-3xl border border-white/10 shadow-2xl flex flex-col overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
              
              <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center">
                <div className={cn(
                  "w-full transition-all duration-500",
                  printCopies > 1 ? "flex flex-wrap gap-4 justify-center" : "flex flex-col items-center justify-center min-h-[250px]"
                )}>
                  {Array.from({ length: Math.min(printCopies, 12) }).map((_, i) => (
                    <motion.div 
                      key={i}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className={cn(
                        "relative flex flex-col items-center bg-white p-4 rounded-xl shadow-lg shrink-0",
                        printCopies > 1 ? "p-3 w-40" : "p-10 scale-110"
                      )}
                    >
                      {config.format === 'QR' ? (
                        <QRCodeSVG 
                          id={i === 0 ? "qr-preview-svg" : undefined}
                          value={config.value} 
                          size={printCopies > 1 ? 120 : 180}
                          fgColor={config.lineColor === 'transparent' ? '#000000' : config.lineColor}
                          includeMargin={true}
                        />
                      ) : (
                        i === 0 ? <svg ref={barcodeRef} className="max-w-full"></svg> : <PrintItem config={config} isMultiple={printCopies > 1} isPrint={false} />
                      )}
                      {config.displayValue && (
                        <p className={cn(
                          "mt-2 font-mono font-bold text-black tracking-widest uppercase truncate w-full text-center",
                          printCopies > 1 ? "text-[8px]" : "text-sm"
                        )}>{config.value}</p>
                      )}
                    </motion.div>
                  ))}
                  {printCopies > 12 && (
                    <div className="flex items-center justify-center bg-white/5 border border-white/10 rounded-xl p-6 min-w-[160px] min-h-[140px]">
                      <div className="text-center">
                        <span className="block text-xl font-bold text-slate-300">+{printCopies - 12}</span>
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">More Labels</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-4 bg-white/5 border-t border-white/10 flex items-center justify-between z-10">
                <div className="px-3 py-1 bg-white/5 rounded-full border border-white/10 text-[10px] font-mono text-slate-400">
                  <span className="text-indigo-400">FORMAT:</span> {config.format}
                </div>
                <div className="px-3 py-1 bg-indigo-500/10 rounded-full border border-indigo-500/20 text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                  {printCopies} {printCopies === 1 ? 'Copy' : 'Copies'} Ready
                </div>
              </div>
            </div>

            {/* Inputs & Controls */}
            <div className="space-y-8">
              <div className="relative">
                <label className="absolute -top-2.5 left-4 bg-[#09090B] px-2 text-[10px] font-bold text-indigo-400 uppercase tracking-widest z-10">Input Value</label>
                <input 
                  type="text" 
                  value={config.value} 
                  onChange={(e) => setConfig({ ...config, value: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && saveToHistory()}
                  className="w-full h-16 bg-white/[0.02] border-2 border-white/10 rounded-2xl px-6 text-xl font-mono text-white focus:outline-none focus:border-indigo-500/50 transition-all shadow-inner"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Symbology */}
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 flex flex-col gap-1.5 overflow-hidden">
                  <span className="text-[9px] uppercase font-bold text-slate-500">Symbology</span>
                  <select 
                    value={config.format}
                    onChange={(e) => setConfig({ ...config, format: e.target.value as BarcodeFormat })}
                    className="bg-transparent text-xs text-white focus:outline-none border-none p-0 cursor-pointer w-full"
                  >
                    <option value="CODE128">Code 128</option>
                    <option value="EAN13">EAN-13</option>
                    <option value="CODE39">Code 39</option>
                    <option value="PHARMACODE">Pharmacode</option>
                    <option value="QR">QR Code</option>
                  </select>
                </div>

                {/* Color */}
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 flex flex-col gap-1.5">
                  <span className="text-[9px] uppercase font-bold text-slate-500">Color Way</span>
                  <div className="flex items-center gap-2 relative">
                    <input 
                      type="color" 
                      value={config.lineColor === 'transparent' ? '#ffffff' : config.lineColor}
                      onChange={(e) => setConfig({ ...config, lineColor: e.target.value })}
                      className="w-4 h-4 rounded-full border border-white/20 bg-transparent cursor-pointer p-0 overflow-hidden shrink-0"
                    />
                    <span className="text-xs uppercase text-slate-300 font-mono text-[9px] truncate">
                      {config.lineColor}
                    </span>
                  </div>
                </div>

                {/* Scaling */}
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 flex flex-col gap-1.5">
                  <span className="text-[9px] uppercase font-bold text-slate-500">Scaling</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-300 text-[9px]">{config.width}x</span>
                    <input 
                      type="range" min="1" max="4" step="1"
                      value={config.width}
                      onChange={(e) => setConfig({ ...config, width: parseInt(e.target.value) })}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500 shadow-none"
                    />
                  </div>
                </div>

                {/* Text Label */}
                <div 
                  className="bg-white/[0.03] border border-white/10 rounded-xl p-3 flex flex-col gap-1.5 cursor-pointer hover:bg-white/[0.05] transition-colors"
                  onClick={() => setConfig({ ...config, displayValue: !config.displayValue })}
                >
                  <span className="text-[9px] uppercase font-bold text-slate-500 text-glow">Text Label</span>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-3 h-3 rounded transition-colors shadow-sm",
                      config.displayValue ? "bg-indigo-600" : "bg-white/10"
                    )} />
                    <span className="text-xs text-slate-300">{config.displayValue ? 'Include' : 'Exclude'}</span>
                  </div>
                </div>

                {/* Print Copies */}
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 flex flex-col gap-1.5">
                  <span className="text-[9px] uppercase font-bold text-slate-500">Print Copies</span>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      min="1" 
                      max="100"
                      value={printCopies}
                      onChange={(e) => setPrintCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                      className="w-full bg-transparent text-xs text-white focus:outline-none border-none p-0 cursor-pointer font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-col md:flex-row gap-4">
                <button 
                  onClick={saveToHistory}
                  className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-indigo-900/20 flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  <Plus size={20} />
                  Archive
                </button>
                <div className="flex gap-2">
                  <button 
                    onClick={() => downloadBarcode('png')}
                    className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors flex items-center justify-center group"
                    title="Download PNG"
                  >
                    <Download size={20} className="text-emerald-400 group-hover:scale-110 transition-transform" />
                  </button>
                  <button 
                    onClick={() => downloadBarcode('svg')}
                    className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors flex items-center justify-center group"
                    title="Download SVG"
                  >
                    <ExternalLink size={20} className="text-sky-400 group-hover:scale-110 transition-transform" />
                  </button>
                  <button 
                    onClick={generatePDF}
                    disabled={isGeneratingPDF}
                    className={cn(
                      "p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl hover:bg-indigo-500/20 transition-all flex items-center justify-center group gap-2",
                      isGeneratingPDF && "opacity-50 cursor-not-allowed"
                    )}
                    title="Download PDF (15 Labels A4)"
                  >
                    {isGeneratingPDF ? (
                      <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <FileText size={20} className="text-indigo-400 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-bold text-indigo-400 pr-1">PDF</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="h-12 shrink-0 border-t border-white/5 bg-[#0C0C0E] flex items-center justify-between px-8 text-[10px] text-slate-500 uppercase tracking-widest font-medium">
          <div className="flex items-center gap-3">
            <span>Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded border border-white/10 text-slate-300">ENTER</kbd> to save</span>
          </div>
          <div className="flex gap-6">
            <span className="flex items-center gap-2">
              <Monitor size={10} />
              SVG • PNG
            </span>
            <span className="text-indigo-400/60 font-bold">v1.2.0-DARK</span>
          </div>
        </footer>
      </main>

      {/* Hidden Print Target */}
      {createPortal(
        <div id="barcode-print-zone" className="print-portal">
          <div className={cn(
            "print-container",
            printCopies > 1 ? "print-grid" : "print-single"
          )}>
            {Array.from({ length: printCopies }).map((_, i) => (
              <div key={i} className="barcode-label">
                <div className="label-content">
                  {config.format === 'QR' ? (
                    <QRCodeSVG value={config.value} size={printCopies > 1 ? 200 : 400} fgColor="#000000" includeMargin={true} />
                  ) : (
                    <PrintItem 
                      config={config} 
                      isMultiple={printCopies > 1}
                      isPrint={true}
                    />
                  )}
                  {config.displayValue && (
                    <p className={cn(
                      "label-text",
                      printCopies > 1 ? "text-sm mt-3" : "text-3xl mt-8"
                    )}>
                      {config.value}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* Global Style overrides */}
      <style>{`
        #barcode-print-zone:not(.pdf-capture-active) {
          display: none;
        }

        #barcode-print-zone.pdf-capture-active {
          display: block !important;
          position: fixed !important;
          left: -4000px !important;
          top: 0 !important;
          width: 210mm !important;
          background: white !important;
          z-index: -9999 !important;
          opacity: 1 !important;
        }

        /* Shared Print/PDF Layouts */
        .print-container {
          width: 100%;
          padding: 10mm;
          background: white;
        }

        .print-grid {
          display: grid !important;
          grid-template-columns: repeat(3, 1fr) !important;
          grid-auto-rows: 52mm !important;
          gap: 5mm !important;
        }

        .print-single {
          display: flex !important;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 90vh;
        }

        .barcode-label {
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          padding: 5mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: white;
          page-break-inside: avoid;
          break-inside: avoid;
          height: 100%;
          max-height: 52mm;
          overflow: hidden;
        }

        .label-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
        }

        .label-text {
          font-family: monospace;
          font-weight: bold;
          color: black;
          text-transform: uppercase;
          text-align: center;
          width: 100%;
          letter-spacing: 0.1em;
          word-break: break-all;
        }

        @media print {
          @page { 
            size: A4; 
            margin: 0; 
          }
          
          #root {
            display: none !important;
          }
          
          #barcode-print-zone:not(.pdf-capture-active) {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            position: static !important;
            opacity: 1 !important;
            background: white !important;
          }
        }
        
        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 12px;
          width: 12px;
          border-radius: 50%;
          background: #4f46e5;
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 0 10px rgba(79, 70, 229, 0.4);
        }
        select {
          appearance: none;
          -webkit-appearance: none;
        }
        option {
          background-color: #121214;
          color: white;
        }
      `}</style>
    </div>
  );
}
