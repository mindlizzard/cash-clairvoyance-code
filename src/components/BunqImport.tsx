import { useMemo, useRef, useState } from "react";
import { Download, FileJson, RotateCcw, ShieldCheck, Trash2, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { store, useStore, type ImportedPositionRecord } from "@/lib/storage";
import {
  MAX_IMPORT_BYTES,
  findConflicts,
  parseBunqSnapshot,
  planImport,
  type ConflictChoice,
  type ParseOk,
} from "@/lib/bunq-import";

const eur = (n: number) =>
  `€${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function BunqImportCard() {
  const { portfolio, imported } = useStore();
  const [parsed, setParsed] = useState<ParseOk | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, ConflictChoice>>({});
  const [backupDone, setBackupDone] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const conflicts = useMemo(
    () => (parsed ? findConflicts(parsed.positions, portfolio, imported) : []),
    [parsed, portfolio, imported],
  );

  const plan = useMemo(
    () => (parsed ? planImport(parsed.positions, portfolio, imported, decisions) : null),
    [parsed, portfolio, imported, decisions],
  );

  const readFile = async (file: File) => {
    setDone(null);
    setDecisions({});
    setParsed(null);
    setErrors([]);
    if (file.size > MAX_IMPORT_BYTES) {
      setErrors([`Bestand is te groot (max ${Math.round(MAX_IMPORT_BYTES / 1024)} kB).`]);
      return;
    }
    const text = await file.text(); // volledig lokaal: geen netwerkverkeer
    const res = parseBunqSnapshot(text, file.size);
    if (res.ok) setParsed(res);
    else setErrors(res.errors);
  };

  const apply = () => {
    if (!parsed || !plan || plan.undecided.length) return;
    store.applyImport(plan.nextImported as ImportedPositionRecord[], {
      source: parsed.meta.source,
      snapshotDate: parsed.meta.snapshotDate,
      snapshotTimeLocal: parsed.meta.snapshotTimeLocal,
      bundleValueEUR: parsed.meta.bundleOverview.valueEUR,
      bundleAllTimeProfitEUR: parsed.meta.bundleOverview.allTimeProfitEUR,
      bundleObservedAtLocal: parsed.meta.bundleOverview.observedAtLocal,
      scope: parsed.meta.bundleOverview.scope,
      importedAt: Date.now(),
    }, plan.removePositionIds);
    setDone(
      `${plan.nextImported.length} positie(s) opgeslagen${plan.skippedKeys.length ? `, ${plan.skippedKeys.length} overgeslagen` : ""}.`,
    );
    setParsed(null);
    setDecisions({});
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold">bunq-posities importeren</h4>
          <p className="text-xs text-muted-foreground">
            Kies je eigen JSON-bestand. Het wordt alleen in deze browser gelezen — geen upload, geen server.
          </p>
        </div>
        <ShieldCheck className="h-5 w-5 shrink-0 text-accent" aria-hidden />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            download(`beursziener_backup_${new Date().toISOString().slice(0, 10)}.json`, store.exportBackup());
            setBackupDone(true);
          }}
        >
          <Download className="mr-1 h-3.5 w-3.5" /> Backup downloaden
        </Button>
        <Button size="sm" variant="outline" onClick={() => restoreRef.current?.click()}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Backup herstellen
        </Button>
        <input
          ref={restoreRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Backupbestand kiezen"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const text = await f.text();
            const target = e.target;
            if (!window.confirm("Backup herstellen? Je huidige lokale gegevens worden overschreven.")) {
              target.value = "";
              return;
            }
            const ok = store.restoreBackup(text);
            setErrors(ok ? [] : ["Deze backup kon niet gelezen worden."]);
            setDone(ok ? "Backup hersteld." : null);
            target.value = "";
          }}
        />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void readFile(f);
        }}
        className={`rounded-xl border border-dashed p-5 text-center transition ${dragging ? "border-primary bg-primary/5" : "border-border/70"}`}
      >
        <FileJson className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">Sleep je bestand hierheen of kies het handmatig.</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Alleen formaat beursziener-bunq-snapshot/v1, max {Math.round(MAX_IMPORT_BYTES / 1024)} kB, valuta EUR.
        </p>
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="mr-1 h-3.5 w-3.5" /> bunq JSON importeren
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="bunq JSON-bestand kiezen"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
          }}
        />
      </div>

      {errors.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="mb-1 font-medium text-destructive">Bestand niet geaccepteerd</p>
          <ul className="list-inside list-disc space-y-0.5 text-xs">
            {errors.slice(0, 12).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {done && (
        <p className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm text-accent">{done}</p>
      )}

      {parsed && plan && (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 text-sm">
            <p className="font-medium">Voorbeeld vóór toepassen</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li>Snapshot van {parsed.meta.snapshotDate} {parsed.meta.snapshotTimeLocal} — bron: {parsed.meta.source}</li>
              <li>
                {parsed.totals.count} posities ({parsed.totals.linked} met ticker, {parsed.totals.unlinked} ongekoppeld)
              </li>
              <li>Totale snapshotwaarde: {eur(parsed.totals.valueEUR)}</li>
              <li>Totale kostprijs: {eur(parsed.totals.costBasisEUR)}</li>
              <li>
                Openstaande winst/verlies: {parsed.totals.unrealizedPnLEUR >= 0 ? "+" : ""}
                {eur(parsed.totals.unrealizedPnLEUR)}
              </li>
              <li>
                Bundel all-time winst (apart, niet vermengd): {eur(parsed.meta.bundleOverview.allTimeProfitEUR)}
              </li>
            </ul>
          </div>

          {parsed.warnings.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-card p-3 text-xs">
              <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Waarschuwingen
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                {parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Te importeren posities</caption>
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Instrument</th>
                  <th className="py-2 px-3 text-right font-medium">Aantal</th>
                  <th className="py-2 px-3 text-right font-medium">Snapshotwaarde</th>
                  <th className="py-2 px-3 text-right font-medium">Kostprijs</th>
                  <th className="py-2 px-3 text-right font-medium">Open P&L</th>
                </tr>
              </thead>
              <tbody>
                {parsed.positions.map((p) => (
                  <tr key={p.key} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[10px] uppercase text-muted-foreground">
                        {p.symbol ?? "ongekoppeld / onbekende ticker"}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{p.quantity}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{eur(p.snapshotValueEUR)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{eur(p.costBasisEUR)}</td>
                    <td
                      className={`py-2 px-3 text-right tabular-nums ${p.unrealizedPnLEUR >= 0 ? "text-accent" : "text-destructive"}`}
                    >
                      {p.unrealizedPnLEUR >= 0 ? "+" : ""}
                      {eur(p.unrealizedPnLEUR)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {conflicts.filter((c) => c.existing.length).length > 0 && (
            <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
              <p className="text-sm font-medium">Overlap met bestaande posities — kies per regel</p>
              <p className="text-xs text-muted-foreground">
                Er wordt nooit automatisch bij elkaar opgeteld. Standaard: overslaan.
              </p>
              {conflicts
                .filter((c) => c.existing.length)
                .map((c) => (
                  <div key={c.key} className="rounded-md border border-border/50 p-2">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {c.certainty === "certain"
                        ? `Zelfde ticker als bestaande positie: ${c.existing.map((e) => e.symbol).join(", ")}`
                        : `Mogelijk dezelfde belegging als: ${c.existing.map((e) => e.symbol).join(", ")} (niet zeker — kies zelf)`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={decisions[c.key] === "skip" ? "default" : "outline"}
                        onClick={() => setDecisions((d) => ({ ...d, [c.key]: "skip" }))}
                      >
                        Overslaan
                      </Button>
                      <Button
                        size="sm"
                        variant={decisions[c.key] === "replace" ? "default" : "outline"}
                        onClick={() => setDecisions((d) => ({ ...d, [c.key]: "replace" }))}
                      >
                        Bestaande vervangen
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {!backupDone && (
            <p className="text-xs text-muted-foreground">
              Tip: download eerst een backup van je huidige gegevens.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={apply} disabled={plan.undecided.length > 0}>
              Importeren ({plan.nextImported.length} posities)
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setParsed(null);
                setDecisions({});
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Annuleren
            </Button>
          </div>
          {plan.undecided.length > 0 && (
            <p className="text-xs text-destructive">
              Maak eerst een keuze bij {plan.undecided.length} overlappende positie(s).
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export function ImportedPositionsCard() {
  const { imported, importMeta } = useStore();
  if (!imported.length) return null;

  const totals = imported.reduce(
    (a, p) => ({
      value: a.value + p.snapshotValueEUR,
      cost: a.cost + p.costBasisEUR,
      pnl: a.pnl + p.unrealizedPnLEUR,
    }),
    { value: 0, cost: 0, pnl: 0 },
  );

  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h4 className="text-lg font-semibold">Geïmporteerde bunq-posities</h4>
        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
          Niet live gekoppeld
        </span>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {importMeta
          ? `Snapshot van ${importMeta.snapshotDate} ${importMeta.snapshotTimeLocal} — bron: ${importMeta.source}`
          : "Snapshotgegevens"}
        . Waarden blijven staan zoals in de snapshot; er wordt geen koers of wisselkoers bijgeschat.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Geïmporteerde posities uit snapshot</caption>
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Instrument</th>
              <th className="py-2 px-3 text-right font-medium">Aantal</th>
              <th className="py-2 px-3 text-right font-medium">Snapshotwaarde</th>
              <th className="py-2 px-3 text-right font-medium">Kostprijs</th>
              <th className="py-2 px-3 text-right font-medium">Open P&L</th>
              <th className="py-2 pl-3" />
            </tr>
          </thead>
          <tbody>
            {imported.map((p) => (
              <tr key={p.id} className="border-b border-border/40 last:border-0 align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium">{p.name}</div>
                  <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase text-muted-foreground">
                    <span>{p.symbol ?? "ongekoppeld"}</span>
                    <span className="rounded border border-border/60 px-1">
                      snapshot {new Date(p.snapshotTimestamp).toLocaleString("nl-NL")}
                    </span>
                  </div>
                  {p.warnings.map((w, i) => (
                    <p key={i} className="mt-1 text-[10px] text-muted-foreground">
                      {w}
                    </p>
                  ))}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{p.quantity}</td>
                <td className="py-2 px-3 text-right tabular-nums">{eur(p.snapshotValueEUR)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{eur(p.costBasisEUR)}</td>
                <td
                  className={`py-2 px-3 text-right tabular-nums ${p.unrealizedPnLEUR >= 0 ? "text-accent" : "text-destructive"}`}
                >
                  {p.unrealizedPnLEUR >= 0 ? "+" : ""}
                  {eur(p.unrealizedPnLEUR)}
                </td>
                <td className="py-2 pl-3 text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`${p.name} uit import verwijderen`}
                    onClick={() => store.removeImported(p.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            <tr className="bg-secondary/40 font-semibold">
              <td className="py-2 pr-3" colSpan={2}>
                Totaal snapshot
              </td>
              <td className="py-2 px-3 text-right tabular-nums">{eur(totals.value)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{eur(totals.cost)}</td>
              <td className={`py-2 px-3 text-right tabular-nums ${totals.pnl >= 0 ? "text-accent" : "text-destructive"}`}>
                {totals.pnl >= 0 ? "+" : ""}
                {eur(totals.pnl)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {importMeta && (
        <p className="mt-3 text-xs text-muted-foreground">
          Bundel all-time winst uit snapshot: {eur(importMeta.bundleAllTimeProfitEUR)} — dit is iets anders dan de
          openstaande winst hierboven en wordt niet meegerekend.
        </p>
      )}

      <div className="mt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (window.confirm("Alle geïmporteerde snapshotposities verwijderen? Handmatige posities blijven staan."))
              store.clearImported();
          }}
        >
          Import wissen
        </Button>
      </div>
    </Card>
  );
}
