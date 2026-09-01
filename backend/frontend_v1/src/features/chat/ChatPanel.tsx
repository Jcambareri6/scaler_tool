import { useEffect, useRef, useState } from "react";
import { chatService } from "@/services/chat.service";
import type { ChatMessage } from "@/types";

function AgentThinking() {
  return (
    <div className="flex gap-3 items-start">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: "linear-gradient(135deg, #7c6aff, #4f46e5)", boxShadow: "0 0 10px rgba(124,106,255,0.3)" }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="white">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
        </svg>
      </div>
      <div
        className="flex items-center gap-1.5 px-4 py-3 rounded-2xl rounded-tl-sm"
        style={{
          background: "rgba(255,255,255,0.05)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.09)",
        }}
      >
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="rounded-full animate-bounce"
            style={{ width: 5, height: 5, background: "var(--muted-foreground)", animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function ToolIndicator({ tool }: { tool: string }) {
  return (
    <div className="flex items-center gap-2 my-1">
      <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.06)" }} />
      <span
        className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-full"
        style={{
          background: "rgba(124,106,255,0.09)",
          border: "1px solid rgba(124,106,255,0.18)",
          color: "rgba(167,155,255,0.8)",
        }}
      >
        <span
          className="rounded-full animate-pulse"
          style={{ width: 5, height: 5, background: "#a78bfa", boxShadow: "0 0 5px #a78bfa" }}
        />
        {tool}
      </span>
      <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const time = new Date(message.timestamp).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  const renderContent = (content: string) => {
    return content.split("\n").map((line, i) => {
      const processed = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      return (
        <span key={i}>
          {i > 0 && <br />}
          <span dangerouslySetInnerHTML={{ __html: processed }} />
        </span>
      );
    });
  };

  if (isUser) {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[72%]">
          <div
            className="px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed text-white"
            style={{
              background: "linear-gradient(135deg, #7c6aff 0%, #5b4de8 100%)",
              boxShadow: "0 4px 16px rgba(124,106,255,0.25)",
            }}
          >
            {renderContent(message.content)}
          </div>
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5 justify-end">
              {message.attachments.map((att, i) => (
                <span
                  key={i}
                  className="text-[10px] font-mono px-2 py-0.5 rounded-md"
                  style={{ background: "rgba(124,106,255,0.12)", color: "#c4b5fd", border: "1px solid rgba(124,106,255,0.2)" }}
                >
                  {att.name}
                </span>
              ))}
            </div>
          )}
          <p className="text-[10px] font-mono mt-1 text-right" style={{ color: "var(--muted-foreground)" }}>{time}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: "linear-gradient(135deg, #7c6aff, #4f46e5)", boxShadow: "0 0 10px rgba(124,106,255,0.25)" }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="white">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
        </svg>
      </div>
      <div className="max-w-[72%]">
        <div
          className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
          style={{
            background: "rgba(255,255,255,0.05)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "var(--foreground)",
          }}
        >
          {renderContent(message.content)}
        </div>
        <p className="text-[10px] font-mono mt-1" style={{ color: "var(--muted-foreground)" }}>{time}</p>
      </div>
    </div>
  );
}

interface Props {
  projectId: string;
}

export default function ChatPanel({ projectId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatService.getMessages(projectId).then((msgs) => {
      setMessages(msgs);
      setLoading(false);
    });
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    setThinking(true);
    const userMsg: ChatMessage = {
      id: `tmp-${Date.now()}`,
      projectId,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    try {
      const { agentMessage } = await chatService.sendMessage(projectId, text);
      setMessages((prev) => [...prev.slice(0, -1), userMsg, agentMessage]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        projectId,
        role: "agent",
        content:
          err instanceof Error
            ? `No pude responder: ${err.message}`
            : "No pude responder (error desconocido).",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev.slice(0, -1), userMsg, errorMsg]);
    } finally {
      setThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-t-violet-400 rounded-full animate-spin" style={{ borderColor: "rgba(124,106,255,0.2)", borderTopColor: "#a78bfa" }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(124,106,255,0.08)", border: "1px solid rgba(124,106,255,0.15)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(167,155,255,0.6)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Empezá contándole a la IA sobre qué va tu video
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id}>
                <MessageBubble message={msg} />
              </div>
            ))}
          </>
        )}
        {thinking && <AgentThinking />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <div
          className="flex items-end gap-3 rounded-2xl px-4 py-3 transition-all duration-150"
          style={{
            background: "rgba(255,255,255,0.05)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
          onFocusCapture={(e) => {
            e.currentTarget.style.border = "1px solid rgba(124,106,255,0.4)";
            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(124,106,255,0.08)";
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.border = "1px solid rgba(255,255,255,0.1)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <button
            className="flex-shrink-0 transition-colors mb-0.5"
            style={{ color: "var(--muted-foreground)" }}
            title="Adjuntar archivo"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribí tu mensaje... (Enter para enviar)"
            rows={1}
            className="flex-1 bg-transparent text-sm focus:outline-none resize-none max-h-32 overflow-y-auto"
            style={{ color: "var(--foreground)", minHeight: 24 }}
          />

          <button
            onClick={handleSend}
            disabled={!input.trim() || thinking}
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, #7c6aff, #5b4de8)",
              boxShadow: input.trim() ? "0 0 12px rgba(124,106,255,0.35)" : "none",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        <p className="text-[10px] text-center mt-2 font-mono" style={{ color: "var(--muted-foreground)" }}>
          Enter para enviar · Shift+Enter para nueva línea
        </p>
      </div>
    </div>
  );
}
