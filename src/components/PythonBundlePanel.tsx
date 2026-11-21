import { useEffect, useState } from 'react';
import { Check, Copy, Download, FileCode2, Terminal } from 'lucide-react';
import { t } from '../i18n';
import type { Lang } from '../types';

export function PythonBundlePanel({ lang }: { lang: Lang }) {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('core/collector.py');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/python-files')
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = data.files ?? [];
        setFiles(list);
        if (list.includes('core/collector.py')) setSelected('core/collector.py');
        else if (list.length > 0) setSelected(list[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    fetch(`/api/python-file?path=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((data) => setContent(data.content ?? ''))
      .finally(() => setLoading(false));
  }, [selected]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">{t(lang, 'python_title')}</h2>
          <p className="mt-1 text-xs text-slate-400">{t(lang, 'python_sub')}</p>
        </div>

        <a
          href="/api/python-bundle.zip"
          download="quantradar-python-server.zip"
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 transition-colors whitespace-nowrap"
        >
          <Download className="h-4 w-4" />
          {t(lang, 'python_download')}
        </a>
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#111827] px-4 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-2.5 text-slate-300">
          <Terminal className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="font-medium text-white">{t(lang, 'python_quick')}</span>
          <code className="font-mono ltr-num text-emerald-300">
            pip install -r requirements.txt &amp;&amp; python main.py
          </code>
        </div>
        <span className="font-mono text-slate-400">
          {files.length} {t(lang, 'python_files_count')}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-stretch" dir="ltr">
        <aside className="lg:col-span-3 rounded-lg border border-slate-800 bg-[#111827] p-3 max-h-[620px] overflow-y-auto">
          <div className="px-2 pb-2 mb-2 border-b border-slate-800 text-xs font-medium text-slate-400">
            python_engine/
          </div>
          <ul className="space-y-0.5 text-xs font-mono">
            {files.map((f) => {
              const active = f === selected;
              return (
                <li key={f}>
                  <button
                    type="button"
                    onClick={() => setSelected(f)}
                    className={`w-full flex items-center gap-2 rounded px-2.5 py-1.5 text-left transition-colors truncate ${
                      active
                        ? 'bg-blue-600/20 text-blue-300 font-medium'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    }`}
                  >
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{f}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="lg:col-span-9 rounded-lg border border-slate-800 bg-[#0D131F] flex flex-col max-h-[620px]">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-xs">
            <span className="font-mono text-slate-200">{selected}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#141B29] px-2.5 py-1 text-slate-200 hover:bg-slate-800"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t(lang, 'python_copied') : t(lang, 'python_copy')}
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed font-mono text-slate-200">
            <code>{loading ? 'Loading...' : content}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
