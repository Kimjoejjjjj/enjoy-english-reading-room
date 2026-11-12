"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface PaperSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface PaperSelectProps {
  value: string;
  options: PaperSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * 阅读室风格的下拉：暖纸弹层、墨绿选中态、细边框与圆角，与设置页输入框一致。
 * 组件只负责选择，不发起任何网络请求。
 */
export default function PaperSelect({ value, options, onChange, ariaLabel, placeholder = "请选择", disabled = false }: PaperSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      if (open) {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + delta + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 text-left text-sm font-normal outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${open ? "border-[var(--green)]" : "border-[var(--shelf-line)] hover:border-[var(--green)]"}`}
      >
        <span className={`truncate ${selected ? "text-[var(--ink)]" : "text-[var(--ink-soft)]"}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-[var(--ink-soft)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label={ariaLabel} className="absolute left-0 right-0 z-30 mt-2 max-h-64 overflow-auto rounded-xl border border-[var(--shelf-line)] bg-[#fffdf8] p-1 shadow-lg shadow-[#3a2f1d]/10">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li key={option.value} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? "bg-[var(--paper)]" : ""} ${isSelected ? "bg-[var(--green)]/10 font-semibold text-[var(--green)]" : "text-[var(--ink)]"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint && <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--ink-soft)]">{option.hint}</span>}
                  </span>
                  {isSelected && <Check size={14} className="shrink-0 text-[var(--green)]" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
