"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain, Clock3, Loader2, Target, TrendingUp } from "lucide-react";

export default function CoachPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch("/api/coach").then((response) => response.json()).then(setData); }, []);
  if (!data) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  return <div className="mx-auto max-w-5xl"><div className="mb-8"><p className="text-sm font-medium text-primary">AI English Coach</p><h1 className="text-3xl font-bold">今天怎么学</h1><p className="mt-2 text-sm text-muted-foreground">计划来自你的真实阅读、查词和复习记录，而不是固定课程表。</p></div><div className="mb-6 grid gap-4 md:grid-cols-3"><div className="rounded-2xl border border-border bg-card p-5"><Target className="mb-3 text-primary" /><p className="text-sm text-muted-foreground">当前等级</p><p className="text-2xl font-bold">{data.profile.level}</p></div><div className="rounded-2xl border border-border bg-card p-5"><TrendingUp className="mb-3 text-green-600" /><p className="text-sm text-muted-foreground">阅读能力</p><p className="text-2xl font-bold">{Math.round(data.profile.readingScore)}</p></div><div className="rounded-2xl border border-border bg-card p-5"><Brain className="mb-3 text-purple-600" /><p className="text-sm text-muted-foreground">已收集词汇</p><p className="text-2xl font-bold">{data.stats.wordCount}</p></div></div><section className="rounded-2xl border border-border bg-card p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-semibold">今日 30 分钟计划</h2><p className="mt-1 text-sm text-muted-foreground">{data.plan.rationale}</p></div><Clock3 className="text-primary" /></div><div className="space-y-3">{data.plan.items.map((item: any, index: number) => <Link key={index} href={item.href} className="flex items-center gap-4 rounded-xl border border-border p-4 hover:bg-muted/50"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{index+1}</span><div className="flex-1"><p className="font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.type}</p></div><span className="text-sm text-muted-foreground">{item.minutes} min</span></Link>)}</div></section></div>;
}
