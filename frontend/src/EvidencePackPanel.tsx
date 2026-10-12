import React, { useState } from 'react';

type Citation = {
  citation_id: string; content: string; document_title: string;
  version_no: number; version_state: string; heading_path: string[];
  page_start: number | null; timestamp_start: number | null;
  markdown_start: number | null; markdown_end: number | null;
  quote_start: number | null; quote_end: number | null;
};
type Requirement = {
  requirement_id: string; query: string; status: string; extraction_status: string;
  missing_information: string[]; citations: Citation[];
  conflicts: number[][];
  facts: { event: string; period: string; claim: string; answer: string;
    sources: { citation_id: string; quote: string; quote_start: number; quote_end: number }[] }[];
};
type Pack = { candidate_id: string; requirements: Requirement[] };
const statusLabels: Record<string, string> = { sufficient: '材料支持当前要求', partial: '证据待补充或核查',
  missing: '未找到可支持要求的证据', conflicting: '材料存在待核查冲突' };
const answerLabels: Record<string, string> = { yes: '支持', no: '反向' };

type ClarificationItem = { expression?: string; reason?: string };

export function formatErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  const payload = detail as { code?: string; items?: ClarificationItem[]; detail?: unknown } | null;
  if (payload && payload.code === 'clarification_required' && Array.isArray(payload.items)) {
    const items = payload.items
      .map((item) => [item.expression, item.reason].filter(Boolean).join('：'))
      .filter(Boolean)
      .join('；');
    return items ? `需要先确认：${items}` : '查询条件需要补充后才能执行';
  }
  return JSON.stringify(detail);
}

export function EvidencePackPanel({ api, tenant }: { api: string; tenant: string }) {
  const [query, setQuery] = useState('筛选在上海且有企业知识库和大模型应用项目经验的候选人');
  const [packs, setPacks] = useState<Pack[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [citation, setCitation] = useState<Citation | null>(null);
  const [citationBusy, setCitationBusy] = useState(false);
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Permission-Scopes': 'hr_private' };
  async function read(path: string, options: RequestInit = {}) {
    const response = await fetch(`${api}${path}`, { ...options, headers });
    const data = await response.json();
    if (!response.ok) throw new Error(formatErrorDetail(data.detail));
    return data;
  }
  async function search() {
    setBusy(true); setError(''); setMessage(''); setPacks([]); setCitation(null);
    try {
      const data = await read('/talent-search', { method: 'POST', body: JSON.stringify({ query, include_evidence_pack: true, limit: 8 }) });
      setPacks(data.evidence_packs);
      if (!data.candidate_ids.length) setMessage('当前结构化条件下没有候选人');
      else if (data.evidence_status === 'not_requested') setMessage('查询未包含需要材料取证的要求');
    } catch (e) { setError(e instanceof Error ? e.message : '检索失败'); }
    finally { setBusy(false); }
  }
  async function openCitation(id: string, quoteStart?: number, quoteEnd?: number) {
    setCitation(null); setError(''); setCitationBusy(true);
    const quoteQuery = quoteStart != null && quoteEnd != null
      ? `?quote_start=${quoteStart}&quote_end=${quoteEnd}` : '';
    try { setCitation(await read(`/evidence/citations/${encodeURIComponent(id)}${quoteQuery}`)); }
    catch (e) { setError(e instanceof Error ? e.message : '引用不可用'); }
    finally { setCitationBusy(false); }
  }
  return <details className="evidencePackPanel">
    <summary>人才证据整理与原文核查</summary>
    <div className="recallHead">
      <input aria-label="人才查询" value={query} onChange={e => setQuery(e.target.value)} style={{ flex: 1 }} />
      <button className="ghost" disabled={busy || !query.trim()} onClick={search}>{busy ? '整理中…' : '检索并整理证据'}</button>
    </div>
    {error && <p role="alert" className="chunkError">{error}</p>}
    {message && <p>{message}</p>}
    {citationBusy && <p role="status">正在核查引用权限…</p>}
    {packs.map(pack => <section key={pack.candidate_id}>
      <h3>{pack.candidate_id}</h3>
      {pack.requirements.map(req => <article className="recallCard" key={req.requirement_id}>
        <h4>{req.requirement_id} · {req.query}</h4>
        <p>{statusLabels[req.status]}{req.extraction_status === 'failed' ? ' · 抽取失败，保留原始材料' : ''}</p>
        {req.facts.map((fact, i) => <div key={i}>
          <p>{i + 1}. {fact.event} · {fact.period} · {answerLabels[fact.answer]} {fact.claim}</p>
          {fact.sources.map((ref, j) => <button className="ghost" disabled={citationBusy} key={j} onClick={() => openCitation(ref.citation_id, ref.quote_start, ref.quote_end)}>原文：{ref.quote}</button>)}
        </div>)}
        {req.conflicts.map((pair, i) => <p key={i}>待核查冲突：事实 {pair.map(n => n + 1).join(' 与 ')}</p>)}
        {req.missing_information.length > 0 && <p>待补充：{req.missing_information.join('、')}</p>}
        <details><summary>本轮原始证据（{req.citations.length}）</summary>
          {req.citations.map(ref => <button className="ghost" disabled={citationBusy} key={ref.citation_id} onClick={() => openCitation(ref.citation_id)}>{ref.document_title} · v{ref.version_no}</button>)}
        </details>
      </article>)}
    </section>)}
    {citation && <div className="drawerWrap" onClick={() => setCitation(null)}>
      <article className="drawer" role="dialog" aria-modal="true" aria-label="引用原文" onClick={e => e.stopPropagation()}>
        <div className="drawerHead"><h3>{citation.document_title}</h3><button className="ghost" onClick={() => setCitation(null)}>关闭</button></div>
        <p>版本 {citation.version_no} · {citation.version_state === 'historical' ? '历史版本' : '当前版本'}</p>
        <p>标题路径：{citation.heading_path?.length ? citation.heading_path.join(' / ') : '无'}</p>
        {citation.page_start != null && <p>页码：{citation.page_start}</p>}
        {citation.timestamp_start != null && <p>时间：{citation.timestamp_start} 秒</p>}
        {citation.markdown_start != null && citation.markdown_end != null && <p>Chunk 位置：[{citation.markdown_start}, {citation.markdown_end})</p>}
        {citation.quote_start != null && citation.quote_end != null && <p>Quote 位置：[{citation.quote_start}, {citation.quote_end})</p>}
        <pre className="citationText">{citation.quote_start != null && citation.quote_end != null
          ? <>{Array.from(citation.content).slice(0, citation.quote_start).join('')}<mark>{Array.from(citation.content).slice(citation.quote_start, citation.quote_end).join('')}</mark>{Array.from(citation.content).slice(citation.quote_end).join('')}</>
          : citation.content}</pre>
      </article>
    </div>}
  </details>;
}
