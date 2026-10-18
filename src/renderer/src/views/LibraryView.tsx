// Mockup 01 — library header + filter bar. Grid and data arrive in Phase 1 / Phase 4.

export function LibraryView({ gameCount }: { gameCount: number }) {
  return (
    <section className="flex-1 min-w-0 flex flex-col gap-[18px] px-7 py-6">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display font-bold text-[28px] tracking-[-.02em] text-text-hi">
          Bibliothèque
        </h1>
        <span className="text-text-lo">
          {gameCount} {gameCount > 1 ? 'jeux' : 'jeu'}
        </span>
      </header>

      <div
        data-testid="library-empty"
        className="flex-1 flex flex-col items-center justify-center gap-3 rounded-lg border-[1.5px] border-dashed border-ink-500 text-center"
      >
        <div className="font-display font-bold text-2xl text-text-hi">Aucun jeu pour l’instant</div>
        <p className="max-w-md text-text-mid">
          L’ajout manuel d’un jeu arrive avec la phase 1, la détection des launchers avec la phase
          2.
        </p>
      </div>
    </section>
  )
}
