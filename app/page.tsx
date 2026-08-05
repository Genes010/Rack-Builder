export default function Home() {
  return (
    <main className="app-shell">
      <iframe
        className="rack-frame"
        src="/rack-builder.html"
        title="GenPro Rack Builder"
        allow="clipboard-write"
      />
    </main>
  );
}
