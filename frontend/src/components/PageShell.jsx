export const PageShell = ({ title, eyebrow, children, testId }) => (
  <div data-testid={testId} className="max-w-3xl mx-auto px-6 lg:px-10 pt-28 pb-24 min-h-screen">
    <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-maroon mb-3">{eyebrow}</p>
    <h1 className="font-display font-semibold tracking-tighter text-4xl sm:text-5xl mb-10">{title}</h1>
    <div className="space-y-6 text-sm md:text-base text-zinc-600 leading-relaxed [&_h2]:font-display [&_h2]:font-semibold [&_h2]:text-ink [&_h2]:text-base [&_h2]:md:text-lg [&_h2]:tracking-tight [&_h2]:mt-8 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5">
      {children}
    </div>
  </div>
);
