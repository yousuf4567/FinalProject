/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Send, 
  Bot, 
  User, 
  BookOpen, 
  Sparkles, 
  ChevronRight,
  MessageSquare,
  Info,
  GraduationCap,
  RefreshCw,
  Upload,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjs from 'pdfjs-dist';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Initialize Gemini API
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

interface KnowledgeDocument {
  id: string;
  name: string;
  content: string;
  type: 'pdf' | 'text';
}

const SUBJECTS = ["General", "Chemistry", "Physics", "Biology"] as const;
type Subject = typeof SUBJECTS[number];

const SUBJECT_QUESTIONS: Record<Subject, string[]> = {
  General: [
    "Explain the structure of a plant cell.",
    "What are Newton's Three Laws of Motion?",
    "How does the demand and supply curve work?",
    "Explain the process of photosynthesis.",
    "What is the difference between mitosis and meiosis?"
  ],
  Chemistry: [
    "Explain the periodic trends in electronegativity.",
    "What is the difference between ionic and covalent bonding?",
    "Explain the concept of chemical equilibrium.",
    "How do you calculate the pH of a strong acid?",
    "What are the properties of transition metals?"
  ],
  Physics: [
    "Explain the principle of conservation of energy.",
    "What is the difference between scalar and vector quantities?",
    "Explain Ohm's Law and its applications.",
    "How does the Doppler effect work?",
    "What is the significance of the photoelectric effect?"
  ],
  Biology: [
    "Describe the structure and function of DNA.",
    "Explain the stages of the nitrogen cycle.",
    "What is the role of enzymes in biological reactions?",
    "Describe the human circulatory system.",
    "Explain the theory of natural selection."
  ]
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'model',
      text: "Hello! I'm your A/L mentor. Upload your syllabus documents (PDF or TXT) and select a subject to get started. What would you like to learn today?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeDocument[]>([]);
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<Subject>("General");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const extractTextFromPDF = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ 
        data: arrayBuffer,
        useWorkerFetch: true,
        isEvalSupported: false 
      });
      const pdf = await loadingTask.promise;
      let fullText = "";
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => (item.str || ""))
          .join(" ");
        fullText += pageText + "\n";
      }
      
      return fullText;
    } catch (error) {
      console.error("PDF extraction error:", error);
      throw new Error("Failed to read PDF content. The file might be corrupted or protected.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);
    const newDocs: KnowledgeDocument[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        let content = "";
        if (file.type === "application/pdf") {
          content = await extractTextFromPDF(file);
        } else if (file.type === "text/plain") {
          content = await file.text();
        } else {
          continue; // Skip unsupported files
        }

        if (!content.trim()) {
          throw new Error(`The file "${file.name}" appears to be empty or contains no readable text.`);
        }

        newDocs.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          content,
          type: file.type === "application/pdf" ? 'pdf' : 'text'
        });
      } catch (error: any) {
        console.error(`Error parsing file ${file.name}:`, error);
        setUploadError(error.message || `Failed to process ${file.name}`);
      }
    }

    if (newDocs.length > 0) {
      setKnowledgeBase(prev => [...prev, ...newDocs]);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: `Successfully uploaded ${newDocs.length} document(s). I'll now use these as context for your questions.`,
        timestamp: new Date()
      }]);
    }
    
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeDocument = (id: string) => {
    setKnowledgeBase(prev => prev.filter(doc => doc.id !== id));
  };

  const handleSendMessage = async (text: string = input) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: text.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const model = "gemini-3-flash-preview";
      
      // Prepare context from knowledge base
      const context = knowledgeBase.length > 0 
        ? `\n\nCONTEXT FROM UPLOADED SYLLABUS DOCUMENTS:\n${knowledgeBase.map(doc => `--- Document: ${doc.name} ---\n${doc.content.substring(0, 3000)}`).join('\n\n')}`
        : "";

      const response = await genAI.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: `You are an expert A/L (Advanced Level) mentor specializing in ${selectedSubject === 'General' ? 'all subjects' : selectedSubject}. 
            Your goal is to provide accurate, detailed, and easy-to-understand explanations for students.
            Use clear headings, bullet points, and examples where appropriate.
            
            ${selectedSubject !== 'General' ? `Focus your answers specifically on the ${selectedSubject} syllabus.` : ""}
            
            IMPORTANT: For any mathematical equations, formulas, or derivations, ALWAYS use LaTeX format wrapped in single dollar signs ($) for inline math and double dollar signs ($$) for block math.
            Example: $E = mc^2$ or $$\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$
            
            ${knowledgeBase.length > 0 ? "IMPORTANT: Use the provided context from the student's uploaded syllabus documents to answer the question more accurately. If the information is not in the documents, use your general knowledge but prioritize the documents." : ""}
            
            ${context}
            
            Question: ${text}` }]
          }
        ],
        config: {
          tools: [{ googleSearch: {} }],
        }
      });

      const modelResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: response.text || "I'm sorry, I couldn't generate a response. Please try again.",
        timestamp: new Date()
      };

      setMessages(prev => [...prev, modelResponse]);
    } catch (error) {
      console.error("Error generating content:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "Sorry, I encountered an error. Please check your connection and try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl text-white">
            <GraduationCap size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">A/L mentor</h1>
            <p className="text-xs text-slate-500 font-medium">Your Personal Study Tutor</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowKnowledgeBase(!showKnowledgeBase)}
            className={`relative p-2 rounded-lg transition-all ${
              knowledgeBase.length > 0 
                ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' 
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
            title="Knowledge Base"
          >
            <BookOpen size={20} />
            {knowledgeBase.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {knowledgeBase.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => setMessages([messages[0]])}
            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Clear Chat"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Knowledge Base Sidebar (Overlay on mobile) */}
        <AnimatePresence>
          {showKnowledgeBase && (
            <motion.aside
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              className="absolute lg:relative z-20 w-72 h-full bg-white border-r border-slate-200 flex flex-col shadow-xl lg:shadow-none"
            >
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <BookOpen size={16} /> Knowledge Base
                </h2>
                <button onClick={() => setShowKnowledgeBase(false)} className="lg:hidden text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Upload Syllabus</label>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className={`w-full py-3 px-4 border-2 border-dashed rounded-xl transition-all flex flex-col items-center gap-2 ${
                      uploadError 
                        ? 'border-red-200 bg-red-50 text-red-600' 
                        : 'border-slate-200 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50'
                    }`}
                  >
                    {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                    <span className="text-xs font-medium">{isUploading ? 'Processing...' : 'Upload PDF / TXT'}</span>
                  </button>
                  {uploadError && (
                    <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-100 rounded-lg text-[10px] text-red-600">
                      <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                      <span>{uploadError}</span>
                    </div>
                  )}
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    accept=".pdf,.txt" 
                    multiple 
                    className="hidden" 
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Documents</label>
                  {knowledgeBase.length === 0 ? (
                    <div className="text-center py-8 px-4 bg-slate-50 rounded-xl border border-slate-100">
                      <FileText size={24} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-[11px] text-slate-400">No documents uploaded yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {knowledgeBase.map(doc => (
                        <div key={doc.id} className="group relative bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all">
                          <div className="flex items-start gap-3">
                            <div className="bg-white p-1.5 rounded-lg border border-slate-200 text-indigo-500">
                              <FileText size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-slate-700 truncate">{doc.name}</p>
                              <p className="text-[10px] text-slate-400 capitalize">{doc.type}</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => removeDocument(doc.id)}
                            className="absolute top-2 right-2 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-4 bg-slate-50 border-t border-slate-200">
                <div className="flex items-center gap-2 text-indigo-600 mb-1">
                  <CheckCircle2 size={14} />
                  <span className="text-[11px] font-bold">Context Active</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  AI will prioritize information from these documents when answering.
                </p>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <main className="flex-1 overflow-hidden flex flex-col max-w-4xl mx-auto w-full relative">
          {/* Subject Toggles */}
          <div className="px-6 py-3 bg-white border-b border-slate-100 flex items-center gap-2 overflow-x-auto no-scrollbar">
            {SUBJECTS.map((subject) => (
              <button
                key={subject}
                onClick={() => setSelectedSubject(subject)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                  selectedSubject === subject
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {subject}
              </button>
            ))}
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-3 max-w-[85%] sm:max-w-[75%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${
                      message.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-indigo-600'
                    }`}>
                      {message.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                        message.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-tr-none' 
                          : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                      }`}>
                        <div className="break-words markdown-body">
                          {message.role === 'model' ? (
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm, remarkMath]}
                              rehypePlugins={[rehypeKatex]}
                            >
                              {message.text}
                            </ReactMarkdown>
                          ) : (
                            <div className="whitespace-pre-wrap">{message.text}</div>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 px-1">
                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="flex gap-3 items-center">
                  <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-indigo-600 shadow-sm">
                    <Bot size={16} />
                  </div>
                  <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length === 1 && !isLoading && (
            <div className="px-6 pb-4">
              <p className="text-xs font-semibold text-slate-500 mb-3 flex items-center gap-1.5 uppercase tracking-wider">
                <Sparkles size={14} className="text-amber-500" />
                Try asking about
              </p>
              <div className="flex flex-wrap gap-2">
                {SUBJECT_QUESTIONS[selectedSubject].map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(q)}
                    className="text-xs bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 px-3 py-2 rounded-lg transition-all text-left flex items-center gap-2 group shadow-sm"
                  >
                    <BookOpen size={12} className="text-slate-400 group-hover:text-indigo-500" />
                    {q}
                    <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="p-4 sm:p-6 bg-white border-t border-slate-200">
            {knowledgeBase.length > 0 && (
              <div className="mb-3 flex items-center gap-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 w-fit">
                <CheckCircle2 size={12} />
                USING {knowledgeBase.length} CUSTOM SYLLABUS DOCUMENTS
              </div>
            )}
            <div className="relative group">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Ask a question from your syllabus..."
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none min-h-[56px] max-h-32"
                rows={1}
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!input.trim() || isLoading}
                className={`absolute right-2 bottom-2 p-2 rounded-xl transition-all ${
                  input.trim() && !isLoading 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700' 
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Send size={20} />
              </button>
            </div>
            <p className="text-[10px] text-center text-slate-400 mt-3 flex items-center justify-center gap-1">
              <Info size={10} />
              AI can make mistakes. Always verify with your official syllabus and textbooks.
            </p>
          </div>
        </main>
      </div>

      {/* Footer Info (Desktop Only) */}
      <footer className="hidden lg:flex bg-white border-t border-slate-100 px-6 py-3 items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><BookOpen size={12} /> Science Syllabus</span>
          <span className="flex items-center gap-1"><MessageSquare size={12} /> Commerce Syllabus</span>
          <span className="flex items-center gap-1"><Sparkles size={12} /> Arts Syllabus</span>
        </div>
        <div>Final Project Submission • 2026</div>
      </footer>
    </div>
  );
}
