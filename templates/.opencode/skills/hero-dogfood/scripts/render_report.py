#!/usr/bin/env python3
"""render_report.py — render a hero-dogfood findings JSON into a self-contained HTML report.

Usage:
    python render_report.py <findings.json> <out.html>
"""
import html
import json
import os
import sys
from string import Template

REQUIRED_SESSION_FIELDS = {"scope", "mode", "timestamp", "findings"}
REQUIRED_FINDING_FIELDS = {
    "severity", "phase", "title",
    "what_was_tried", "what_happened", "what_was_expected",
    "evidence", "suggested_next_step",
}
VALID_SEVERITIES = {"blocker", "bug", "friction", "nit"}
VALID_PHASES = {"happy-path", "adversarial", "source"}
SEVERITY_ORDER = {"blocker": 0, "bug": 1, "friction": 2, "nit": 3}


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def esc(s: object) -> str:
    """HTML-escape and also escape $ for string.Template."""
    return html.escape(str(s), quote=True).replace("$", "$$")


def load_and_validate(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        die(f"Input file not found: {path}")
    except json.JSONDecodeError as e:
        die(f"Malformed JSON in {path}: {e}")

    missing = REQUIRED_SESSION_FIELDS - data.keys()
    if missing:
        die(f"Session JSON is missing required fields: {sorted(missing)}")

    if data["mode"] not in ("safe", "dangerous"):
        die(f"'mode' must be 'safe' or 'dangerous', got: {data['mode']!r}")

    if not isinstance(data["findings"], list):
        die("'findings' must be a JSON array")

    for i, f in enumerate(data["findings"]):
        missing_f = REQUIRED_FINDING_FIELDS - f.keys()
        if missing_f:
            die(f"Finding #{i} is missing required fields: {sorted(missing_f)}")
        if f["severity"] not in VALID_SEVERITIES:
            die(f"Finding #{i} has invalid severity: {f['severity']!r}. Must be one of {sorted(VALID_SEVERITIES)}")
        if f["phase"] not in VALID_PHASES:
            die(f"Finding #{i} has invalid phase: {f['phase']!r}. Must be one of {sorted(VALID_PHASES)}")

    return data


def render_sev_badge(sev: str) -> str:
    return f'<span class="sev sev-{esc(sev)}">{esc(sev)}</span>'


def render_evidence(evidence_list: list) -> str:
    if not evidence_list:
        return ""
    items = []
    for ev in evidence_list:
        cmd = esc(ev.get("command", ""))
        out = esc(ev.get("output", ""))
        refs = ev.get("file_refs", [])
        refs_html = ""
        if refs:
            refs_html = '<div class="evidence-refs">refs: ' + ", ".join(
                f'<code>{esc(r)}</code>' for r in refs
            ) + "</div>"
        items.append(
            f'<div class="evidence-block">'
            f'<div class="evidence-cmd">$ {cmd}</div>'
            f'<div class="evidence-output">{out}</div>'
            f'{refs_html}'
            f'</div>'
        )
    count = len(items)
    label = f"{count} evidence item{'s' if count != 1 else ''}"
    inner = "\n".join(items)
    return (
        f"<details><summary>{label}</summary>\n"
        f"{inner}\n"
        f"</details>"
    )


def render_finding_card(idx: int, f: dict) -> str:
    sev = f["severity"]
    phase = f["phase"]
    title = esc(f["title"])
    what_tried = esc(f["what_was_tried"])
    what_happened = esc(f["what_happened"])
    what_expected = esc(f["what_was_expected"])
    next_step = esc(f["suggested_next_step"])
    evidence_html = render_evidence(f.get("evidence", []))

    return f"""  <div class="card finding-card sev-{esc(sev)}" id="finding-{idx}">
    <div class="finding-meta">
      <strong>#{idx}</strong>
      {render_sev_badge(sev)}
      <span style="font-size:.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">{esc(phase)}</span>
    </div>
    <h3>{title}</h3>
    <div class="field-label">What was tried</div>
    <div class="field-value">{what_tried}</div>
    <div class="field-label">What happened</div>
    <div class="field-value">{what_happened}</div>
    <div class="field-label">What was expected</div>
    <div class="field-value">{what_expected}</div>
    {evidence_html}
    <div class="field-label">Suggested next step</div>
    <div class="next-step">{next_step}</div>
  </div>"""


def render_phase_cards(findings: list, phase: str) -> str:
    phase_findings = [(i + 1, f) for i, f in enumerate(findings) if f["phase"] == phase]
    if not phase_findings:
        return '  <p style="color:var(--text-muted);font-style:italic">No findings for this phase.</p>'
    return "\n".join(render_finding_card(idx, f) for idx, f in phase_findings)


def render_table_row(idx: int, f: dict) -> str:
    sev = f["severity"]
    phase = f["phase"]
    title = esc(f["title"])
    return (
        f'        <tr>'
        f'<td><a href="#finding-{idx}" style="color:var(--accent)">{idx}</a></td>'
        f'<td>{render_sev_badge(sev)}</td>'
        f'<td>{esc(phase)}</td>'
        f'<td>{title}</td>'
        f'</tr>'
    )


def render_top_findings(findings: list) -> str:
    sorted_f = sorted(
        enumerate(findings, 1),
        key=lambda x: SEVERITY_ORDER.get(x[1]["severity"], 99)
    )
    top = sorted_f[:3]
    if not top:
        return '      <li style="color:var(--text-muted)">No findings.</li>'
    lines = []
    for idx, f in top:
        lines.append(
            f'      <li>'
            f'{render_sev_badge(f["severity"])}'
            f' <a href="#finding-{idx}" style="color:var(--text)">{esc(f["title"])}</a>'
            f'</li>'
        )
    return "\n".join(lines)


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: render_report.py <findings.json> <out.html>", file=sys.stderr)
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]
    data = load_and_validate(input_path)

    # Locate template relative to this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    template_path = os.path.join(script_dir, "..", "assets", "report-template.html")
    template_path = os.path.normpath(template_path)

    if not os.path.exists(template_path):
        die(f"Template not found: {template_path}")

    with open(template_path, encoding="utf-8") as f:
        template_src = f.read()

    findings = data["findings"]
    mode = data["mode"]

    counts = {sev: 0 for sev in VALID_SEVERITIES}
    for f in findings:
        counts[f["severity"]] += 1

    substitutions = {
        "scope": esc(data["scope"]),
        "mode": esc(mode),
        "mode_class": f"mode-{esc(mode)}",
        "timestamp": esc(data["timestamp"]),
        "count_blocker":  str(counts["blocker"]),
        "count_bug":      str(counts["bug"]),
        "count_friction": str(counts["friction"]),
        "count_nit":      str(counts["nit"]),
        "top_findings_html":   render_top_findings(findings),
        "happy_path_html":     render_phase_cards(findings, "happy-path"),
        "adversarial_html":    render_phase_cards(findings, "adversarial"),
        "source_html":         render_phase_cards(findings, "source"),
        "findings_table_rows": "\n".join(
            render_table_row(i + 1, f) for i, f in enumerate(findings)
        ),
        "finding_cards_html":  "\n".join(
            render_finding_card(i + 1, f) for i, f in enumerate(findings)
        ),
    }

    try:
        output = Template(template_src).substitute(substitutions)
    except (KeyError, ValueError) as e:
        die(f"Template substitution failed: {e}")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(output)

    print(f"Report written to: {output_path}")


if __name__ == "__main__":
    main()
