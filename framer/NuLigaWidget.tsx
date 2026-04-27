// BTV Nottuln – nuLiga Spielplan-Komponente für Framer
// 1. In Framer: Assets → Code → + New Component → diesen Code einfügen
// 2. API_URL auf deine Vercel-URL anpassen (z.B. https://deinprojekt.vercel.app/api/nuliga)

import { useState, useEffect } from "react"
import { addPropertyControls, ControlType } from "framer"

const API_URL = "https://deinprojekt.vercel.app/api/nuliga"

// ─── HILFSFUNKTIONEN ─────────────────────────────────────────────────────────

function formatDate(dateStr) {
    if (!dateStr) return ""
    const parts = dateStr.split(".")
    if (parts.length < 3) return dateStr
    const [day, month, year] = parts
    const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
        "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]
    return `${parseInt(day)}. ${months[parseInt(month) - 1]} ${year}`
}

function getWeekday(dateStr) {
    if (!dateStr) return ""
    const parts = dateStr.split(".")
    if (parts.length < 3) return ""
    const date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
    const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
    return days[date.getDay()]
}

// ─── MATCH CARD ──────────────────────────────────────────────────────────────

function MatchCard({ match, accentColor, cardBg, textColor, subtextColor, borderColor }) {
    const isHome = match.isHome
    const homeIsNottuln = match.home.includes("Nottuln")
    const hasResult = match.homeScore !== null && match.awayScore !== null

    return (
        <div style={{
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 12,
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
        }}>
            {/* Meta */}
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
            }}>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}>
                    <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        color: accentColor,
                        background: accentColor + "18",
                        padding: "2px 8px",
                        borderRadius: 4,
                    }}>
                        {isHome ? "Heim" : "Auswärts"}
                    </span>
                    <span style={{
                        fontSize: 11,
                        color: subtextColor,
                        fontWeight: 500,
                    }}>
                        {match.league}
                    </span>
                </div>
                <span style={{
                    fontSize: 12,
                    color: subtextColor,
                    fontWeight: 500,
                }}>
                    {getWeekday(match.date)}. {formatDate(match.date)}
                    {match.time ? ` · ${match.time} Uhr` : ""}
                </span>
            </div>

            {/* Teams & Ergebnis */}
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                justifyContent: "space-between",
            }}>
                {/* Heimteam */}
                <div style={{
                    flex: 1,
                    textAlign: "left",
                }}>
                    <span style={{
                        fontSize: 15,
                        fontWeight: homeIsNottuln ? 700 : 400,
                        color: homeIsNottuln ? textColor : subtextColor,
                        lineHeight: 1.3,
                    }}>
                        {match.home}
                    </span>
                </div>

                {/* Score / VS */}
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                }}>
                    {hasResult ? (
                        <>
                            <span style={{
                                fontSize: 20,
                                fontWeight: 800,
                                color: textColor,
                                fontVariantNumeric: "tabular-nums",
                                minWidth: 24,
                                textAlign: "center",
                            }}>
                                {match.homeScore}
                            </span>
                            <span style={{ color: subtextColor, fontWeight: 300 }}>:</span>
                            <span style={{
                                fontSize: 20,
                                fontWeight: 800,
                                color: textColor,
                                fontVariantNumeric: "tabular-nums",
                                minWidth: 24,
                                textAlign: "center",
                            }}>
                                {match.awayScore}
                            </span>
                        </>
                    ) : (
                        <span style={{
                            fontSize: 13,
                            color: subtextColor,
                            fontWeight: 500,
                            padding: "4px 10px",
                            border: `1px solid ${borderColor}`,
                            borderRadius: 6,
                        }}>
                            vs
                        </span>
                    )}
                </div>

                {/* Gastteam */}
                <div style={{
                    flex: 1,
                    textAlign: "right",
                }}>
                    <span style={{
                        fontSize: 15,
                        fontWeight: !homeIsNottuln ? 700 : 400,
                        color: !homeIsNottuln ? textColor : subtextColor,
                        lineHeight: 1.3,
                    }}>
                        {match.away}
                    </span>
                </div>
            </div>

            {/* Status-Badge bei Verlegung */}
            {match.status === "rescheduled" && (
                <div style={{
                    fontSize: 11,
                    color: "#f59e0b",
                    background: "#f59e0b18",
                    padding: "2px 8px",
                    borderRadius: 4,
                    alignSelf: "flex-start",
                    fontWeight: 600,
                }}>
                    Verlegt
                </div>
            )}
        </div>
    )
}

// ─── TEAM ROW ────────────────────────────────────────────────────────────────

function TeamRow({ team, accentColor, textColor, subtextColor, borderColor }) {
    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 0",
            borderBottom: `1px solid ${borderColor}`,
            gap: 12,
        }}>
            <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: accentColor + "18",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: accentColor,
                flexShrink: 0,
            }}>
                {team.rank || "–"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: textColor,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}>
                    {team.name}
                </div>
                <div style={{
                    fontSize: 12,
                    color: subtextColor,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}>
                    {team.league}
                </div>
            </div>
            <div style={{
                fontSize: 13,
                fontWeight: 700,
                color: textColor,
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
            }}>
                {team.points}
            </div>
        </div>
    )
}

// ─── HAUPT-KOMPONENTE ────────────────────────────────────────────────────────

export default function NuLigaWidget({
    mode,
    title,
    maxItems,
    accentColor,
    backgroundColor,
    cardBackground,
    textColor,
    subtextColor,
    borderColor,
    showUpcoming,
    fontFamily,
}) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState("upcoming")

    useEffect(() => {
        const endpoint = mode === "teams"
            ? `${API_URL}?type=teams`
            : `${API_URL}?type=matches`

        fetch(endpoint)
            .then(r => r.json())
            .then(d => { setData(d); setLoading(false) })
            .catch(e => { setError(e.message); setLoading(false) })
    }, [mode])

    const containerStyle = {
        width: "100%",
        fontFamily: fontFamily || "'DM Sans', system-ui, sans-serif",
        background: backgroundColor,
        borderRadius: 16,
        padding: 24,
        boxSizing: "border-box",
    }

    if (loading) return (
        <div style={{ ...containerStyle, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 }}>
            <div style={{ color: subtextColor, fontSize: 14 }}>Lade Daten…</div>
        </div>
    )

    if (error) return (
        <div style={{ ...containerStyle, color: "#ef4444", fontSize: 14 }}>
            Fehler: {error}
        </div>
    )

    // ── TEAMS-MODUS ──
    if (mode === "teams") {
        const currentTeams = data?.teams?.filter(t =>
            t.season.includes("Sommer 2026")
        ).slice(0, maxItems) || []

        return (
            <div style={containerStyle}>
                {title && (
                    <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: textColor }}>
                        {title}
                    </h3>
                )}
                <div>
                    {currentTeams.map((team, i) => (
                        <TeamRow
                            key={i}
                            team={team}
                            accentColor={accentColor}
                            textColor={textColor}
                            subtextColor={subtextColor}
                            borderColor={borderColor}
                        />
                    ))}
                    {currentTeams.length === 0 && (
                        <div style={{ color: subtextColor, fontSize: 14, textAlign: "center", padding: 32 }}>
                            Keine Mannschaftsdaten gefunden.
                        </div>
                    )}
                </div>
            </div>
        )
    }

    // ── MATCHES-MODUS ──
    const upcoming = (data?.upcoming || []).slice(0, maxItems)
    const played = (data?.played || []).slice(0, maxItems)
    const displayMatches = activeTab === "upcoming" ? upcoming : played

    return (
        <div style={containerStyle}>
            {title && (
                <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: textColor }}>
                    {title}
                </h3>
            )}

            {/* Tabs */}
            <div style={{
                display: "flex",
                gap: 4,
                marginBottom: 16,
                background: borderColor + "40",
                borderRadius: 10,
                padding: 4,
            }}>
                {[
                    { id: "upcoming", label: `Anstehend (${upcoming.length})` },
                    { id: "played", label: `Ergebnisse (${played.length})` },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            flex: 1,
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "none",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                            fontFamily: "inherit",
                            background: activeTab === tab.id ? accentColor : "transparent",
                            color: activeTab === tab.id ? "#fff" : subtextColor,
                            transition: "all 0.15s ease",
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Match Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {displayMatches.map((match, i) => (
                    <MatchCard
                        key={i}
                        match={match}
                        accentColor={accentColor}
                        cardBg={cardBackground}
                        textColor={textColor}
                        subtextColor={subtextColor}
                        borderColor={borderColor}
                    />
                ))}
                {displayMatches.length === 0 && (
                    <div style={{
                        color: subtextColor,
                        fontSize: 14,
                        textAlign: "center",
                        padding: 40,
                    }}>
                        {activeTab === "upcoming"
                            ? "Keine anstehenden Spiele."
                            : "Noch keine Ergebnisse vorhanden."}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: `1px solid ${borderColor}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
            }}>
                <span style={{ fontSize: 11, color: subtextColor }}>
                    Quelle: wtv.liga.nu
                </span>
                <a
                    href="https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/clubMeetings?club=26684"
                    target="_blank"
                    style={{
                        fontSize: 11,
                        color: accentColor,
                        textDecoration: "none",
                        fontWeight: 600,
                    }}
                >
                    Alle Spiele →
                </a>
            </div>
        </div>
    )
}

// ─── FRAMER PROPERTY CONTROLS ────────────────────────────────────────────────

addPropertyControls(NuLigaWidget, {
    mode: {
        type: ControlType.Enum,
        title: "Ansicht",
        options: ["matches", "teams"],
        optionTitles: ["Spielplan", "Mannschaften"],
        defaultValue: "matches",
    },
    title: {
        type: ControlType.String,
        title: "Titel",
        defaultValue: "Spielplan BTV Nottuln",
    },
    maxItems: {
        type: ControlType.Number,
        title: "Max. Einträge",
        defaultValue: 10,
        min: 3,
        max: 50,
        step: 1,
    },
    accentColor: {
        type: ControlType.Color,
        title: "Akzentfarbe",
        defaultValue: "#2D7A3A",
    },
    backgroundColor: {
        type: ControlType.Color,
        title: "Hintergrund",
        defaultValue: "#ffffff",
    },
    cardBackground: {
        type: ControlType.Color,
        title: "Karten-Hintergrund",
        defaultValue: "#f8f9fa",
    },
    textColor: {
        type: ControlType.Color,
        title: "Textfarbe",
        defaultValue: "#111111",
    },
    subtextColor: {
        type: ControlType.Color,
        title: "Sekundärtext",
        defaultValue: "#6b7280",
    },
    borderColor: {
        type: ControlType.Color,
        title: "Rahmenfarbe",
        defaultValue: "#e5e7eb",
    },
    fontFamily: {
        type: ControlType.String,
        title: "Schriftart",
        defaultValue: "'DM Sans', system-ui, sans-serif",
    },
})
