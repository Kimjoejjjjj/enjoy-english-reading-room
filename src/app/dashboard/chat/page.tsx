// src/app/dashboard/chat/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Bot, User, Languages, Volume2 } from "lucide-react";

interface ChatMessage {
  id: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translationMap, setTranslationMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      if (!res.ok) throw new Error("Failed to load messages");
      const data = await res.json();
      setMessages(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const userText = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    // Optimistic: show user message immediately
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempId,
      userId: "",
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
    }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userText }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      const data = await res.json();

      setMessages(prev => [
        ...prev.filter(m => m.id !== tempId),
        data.userMessage,
        data.aiMessage,
      ]);
    } catch (e: any) {
      setError(e.message);
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const handleTranslate = async (messageId: string, content: string) => {
    if (translationMap[messageId]) return; // Already translated
    setTranslatingId(messageId);
    try {
      // TODO: Replace with real translation API call
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      if (!res.ok) throw new Error("Translation failed");
      const data = await res.json();
      setTranslationMap(prev => ({ ...prev, [messageId]: data.translated }));
    } catch (e: any) {
      // Fallback: just wrap in quotes for now
      setTranslationMap(prev => ({ ...prev, [messageId]: `"${content}"` }));
    } finally {
      setTranslatingId(null);
    }
  };

  const handleSpeak = (content: string) => {
    // Use Web Speech API for synthesis
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.lang = "en-US";
      speechSynthesis.speak(utterance);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-6rem)] flex-col items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading chat...</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">AI Chat</h1>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex items-start gap-3 ${
                message.role === "user" ? "flex-row-reverse" : ""
              }`}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {message.role === "user" ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div className="group max-w-[70%]">
                <div
                  className={`rounded-lg px-4 py-2 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                </div>
                {/* Inline actions: only show on assistant messages */}
                {message.role === "assistant" && (
                  <div className="mt-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleTranslate(message.id, message.content)}
                      disabled={translatingId === message.id}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <Languages size={12} />
                      {translatingId === message.id ? "Translating..." : "翻译"}
                    </button>
                    <button
                      onClick={() => handleSpeak(message.content)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Volume2 size={12} />
                      朗读
                    </button>
                  </div>
                )}
                {/* Show translation below assistant message */}
                {message.role === "assistant" && translationMap[message.id] && (
                  <div className="mt-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5">
                    <p className="text-xs text-blue-700">{translationMap[message.id]}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Bot size={16} />
              </div>
              <div className="max-w-[70%] rounded-lg bg-muted px-4 py-2">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "0ms" }}></span>
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "150ms" }}></span>
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "300ms" }}></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="mt-4 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type your message..."
          disabled={sending}
          className="flex-1 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="rounded-lg bg-primary p-2 text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
