# ================================================================
# R/standings_engine.R — real division/conference standings + official
# tiebreaker cascades + playoff-field construction for NBA, NHL, MLB, NFL.
#
# Sourced by R/update_current_standings.R. Consumes each sport's already-
# written <SPORT>_Elo_<yr>.csv (for the team roster + each team's division,
# via its `conference` column — that column actually holds the DIVISION,
# e.g. "AFC South", not the conference; see div_conf() below) and the new
# <SPORT>_Games_<yr>.csv game log each update_<sport>.R script now writes
# alongside it.
#
# HONESTY NOTE (read this before trusting a "why did this team make it"
# claim from the output): the tiebreaker cascades below implement each
# league's OFFICIAL criteria in OFFICIAL order for the steps that are
# realistically computable from box-score-level data — head-to-head,
# division record, conference record, common games, NHL's points/RW/ROW
# system, NFL's strength of victory/schedule, MLB's second-half split.
# Every league's real procedure eventually reaches at least one step this
# site can't compute (NBA's "win% vs currently-playoff-eligible teams" is
# circular by construction; NFL's "net touchdowns" needs play-by-play data;
# MLB's "most recent head-to-head, working backward" and every league's
# literal coin-toss/draw are either impractical or not really "rules" you
# compute at all). Once a tie survives every implemented criterion, this
# engine breaks it by Playoff Rating-style Elo — the same disclosed
# approximation pattern already used in the CFB playoff-chance feature for
# an analogous gap. Multi-team ties are resolved by the standard
# "eliminate down at each step, recurse within whichever sub-group is still
# tied" approach — a reasonable, if not byte-for-byte official, model of
# each league's real "reduce the field, then restart" procedures.
# ================================================================

# ── Division -> conference/league ───────────────────────────────
# Division names/membership don't need re-deriving here: they're already
# correct per-team in each season's *_Elo_<yr>.csv `conference` column
# (built by each update_<sport>.R's own DIVS map, hand-kept in sync with
# every historical realignment). Only the small division-name ->
# conference-name step lives here.
DIV_TO_CONF <- list(
  NBA = c(Atlantic="Eastern", Central="Eastern", Southeast="Eastern",
          Northwest="Western", Pacific="Western", Southwest="Western"),
  NHL = c(Atlantic="Eastern", Metropolitan="Eastern",
          Central="Western", Pacific="Western")
  # MLB/NFL: the division string itself already starts with the league/
  # conference code ("AL East", "AFC North", ...) — see div_conf() below.
)

div_conf <- function(sport, division) {
  if (is.null(division) || is.na(division) || !nchar(division)) return(NA_character_)
  if (sport == "MLB") {
    if (startsWith(division, "AL")) return("AL")
    if (startsWith(division, "NL")) return("NL")
    return(NA_character_)
  }
  if (sport == "NFL") {
    if (startsWith(division, "AFC")) return("AFC")
    if (startsWith(division, "NFC")) return("NFC")
    return(NA_character_)
  }
  map <- DIV_TO_CONF[[sport]]
  if (is.null(map) || !division %in% names(map)) return(NA_character_)
  unname(map[[division]])
}

# ── Per-team record from the game log ───────────────────────────
# NHL gets extra columns (points/reg_wins/ot_wins/otl) for its points-based
# standings; the other three sports are plain win-loss.
build_records <- function(sport, games, all_teams) {
  n <- length(all_teams)
  rec <- data.frame(team = all_teams, wins = integer(n), losses = integer(n),
                     stringsAsFactors = FALSE)
  if (sport == "NHL") {
    rec$points <- integer(n); rec$reg_wins <- integer(n)
    rec$ot_wins <- integer(n); rec$otl <- integer(n)
  }
  rec$pf <- numeric(n); rec$pa <- numeric(n)  # points/runs/goals for & against, for point-diff criteria
  rownames(rec) <- all_teams

  if (is.data.frame(games) && nrow(games)) {
    for (i in seq_len(nrow(games))) {
      w <- games$winner[i]; l <- games$loser[i]
      wp <- suppressWarnings(as.numeric(games$winner_pts[i]))
      lp <- suppressWarnings(as.numeric(games$loser_pts[i]))
      et <- if ("end_type" %in% names(games)) games$end_type[i] else "REG"
      if (!is.na(w) && w %in% all_teams) {
        rec[w, "wins"]   <- rec[w, "wins"] + 1L
        if (!is.na(wp)) rec[w, "pf"] <- rec[w, "pf"] + wp
        if (!is.na(lp)) rec[w, "pa"] <- rec[w, "pa"] + lp
        if (sport == "NHL") {
          rec[w, "points"] <- rec[w, "points"] + 2L
          if (identical(et, "REG")) rec[w, "reg_wins"] <- rec[w, "reg_wins"] + 1L
          else rec[w, "ot_wins"] <- rec[w, "ot_wins"] + 1L
        }
      }
      if (!is.na(l) && l %in% all_teams) {
        rec[l, "losses"] <- rec[l, "losses"] + 1L
        if (!is.na(lp)) rec[l, "pf"] <- rec[l, "pf"] + lp
        if (!is.na(wp)) rec[l, "pa"] <- rec[l, "pa"] + wp
        if (sport == "NHL" && !identical(et, "REG")) {
          rec[l, "points"] <- rec[l, "points"] + 1L
          rec[l, "otl"] <- rec[l, "otl"] + 1L
        }
      }
    }
  }
  rec$games_played <- rec$wins + rec$losses
  rec$win_pct <- ifelse(rec$games_played > 0, rec$wins / rec$games_played, 0)
  if (sport == "NHL") {
    rec$points_pct <- ifelse(rec$games_played > 0, rec$points / (rec$games_played * 2), 0)
  }
  rec
}

# ── Generic recursive tiebreak resolver ─────────────────────────
# criteria: list of function(team_subset) -> named numeric vector (higher
# is better). Applies criteria[[1]] to the whole tied group, splits into
# sub-groups by value, recurses into each sub-group (still tied) with
# criteria[[2]], etc. Falls back to descending Elo once criteria run out —
# see the module-level HONESTY NOTE above.
resolve_tiebreak_order <- function(teams, criteria, elo_lookup, idx = 1) {
  if (length(teams) <= 1) return(teams)
  if (idx > length(criteria)) {
    e <- elo_lookup[teams]
    return(teams[order(-ifelse(is.na(e), -Inf, e))])
  }
  vals <- tryCatch(criteria[[idx]](teams), error = function(e) setNames(rep(NA_real_, length(teams)), teams))
  have <- teams[!is.na(vals[teams])]
  none <- teams[is.na(vals[teams])]
  ordered <- character(0)
  if (length(have)) {
    uniq_vals <- sort(unique(vals[have]), decreasing = TRUE)
    for (v in uniq_vals) {
      grp <- have[vals[have] == v]
      if (length(grp) > 1) grp <- resolve_tiebreak_order(grp, criteria, elo_lookup, idx + 1)
      ordered <- c(ordered, grp)
    }
  }
  if (length(none)) {
    none <- resolve_tiebreak_order(none, criteria, elo_lookup, idx + 1)
    ordered <- c(ordered, none)
  }
  ordered
}

# ── Shared criterion builders (closures over one season's game log) ────
# Each returns function(teams) -> named numeric vector, higher = better,
# NA for "not applicable / no games" (treated as worst-tier by the
# resolver, matching each league's real "insufficient data" handling).

crit_head_to_head <- function(games) {
  function(teams) {
    sub <- games[games$winner %in% teams & games$loser %in% teams, ]
    w <- setNames(rep(0L, length(teams)), teams)
    g <- setNames(rep(0L, length(teams)), teams)
    if (nrow(sub)) {
      tw <- table(sub$winner); tg <- table(c(sub$winner, sub$loser))
      w[intersect(names(tw), teams)] <- as.integer(tw[intersect(names(tw), teams)])
      g[intersect(names(tg), teams)] <- as.integer(tg[intersect(names(tg), teams)])
    }
    ifelse(g > 0, w / g, NA_real_)
  }
}

crit_group_record <- function(games, team_group, group_of) {
  # team_group: named vector team -> group label (division or conference)
  # group_of: function(team) -> the group a candidate team must share with
  # its opponent for that game to count (i.e. "record vs your own
  # division/conference", regardless of which other tied teams are in it)
  function(teams) {
    sapply(teams, function(t) {
      grp <- team_group[[t]]
      if (is.null(grp) || is.na(grp)) return(NA_real_)
      opp_in_grp <- names(team_group)[!is.na(team_group) & team_group == grp & names(team_group) != t]
      sub <- games[(games$winner == t & games$loser %in% opp_in_grp) |
                   (games$loser == t & games$winner %in% opp_in_grp), ]
      if (!nrow(sub)) return(NA_real_)
      sum(sub$winner == t) / nrow(sub)
    })
  }
}

crit_common_games <- function(games, min_games = 4) {
  # NFL-style: record against opponents common to EVERY team in the tied
  # group, only counted if at least `min_games` such common games exist.
  function(teams) {
    opp_sets <- lapply(teams, function(t) {
      union(games$loser[games$winner == t], games$winner[games$loser == t])
    })
    common <- Reduce(intersect, opp_sets)
    common <- setdiff(common, teams)
    sapply(teams, function(t) {
      sub <- games[(games$winner == t & games$loser %in% common) |
                   (games$loser == t & games$winner %in% common), ]
      if (nrow(sub) < min_games) return(NA_real_)
      sum(sub$winner == t) / nrow(sub)
    })
  }
}

crit_point_diff <- function(records) {
  function(teams) {
    sapply(teams, function(t) {
      if (!t %in% rownames(records)) return(NA_real_)
      records[t, "pf"] - records[t, "pa"]
    })
  }
}

# NFL strength of victory / strength of schedule — needs full-league
# records (every opponent's own win%), not just the tied group's data.
crit_strength_of_victory <- function(games, all_win_pct) {
  function(teams) {
    sapply(teams, function(t) {
      opps <- games$loser[games$winner == t]
      if (!length(opps)) return(NA_real_)
      mean(all_win_pct[opps], na.rm = TRUE)
    })
  }
}
crit_strength_of_schedule <- function(games, all_win_pct) {
  function(teams) {
    sapply(teams, function(t) {
      opps <- c(games$loser[games$winner == t], games$winner[games$loser == t])
      if (!length(opps)) return(NA_real_)
      mean(all_win_pct[opps], na.rm = TRUE)
    })
  }
}

# MLB "second half of season" record — approximated as games on/after the
# season's own midpoint DATE (not the real All-Star-break game count split,
# which this site has no access to; a documented approximation).
crit_second_half <- function(games) {
  dated <- games[!is.na(games$date) & nchar(games$date) > 0, ]
  if (!nrow(dated)) return(function(teams) setNames(rep(NA_real_, length(teams)), teams))
  mid <- as.character(sort(as.Date(dated$date))[max(1, floor(nrow(dated) / 2))])
  sub <- dated[dated$date >= mid, ]
  function(teams) {
    sapply(teams, function(t) {
      g <- sub[sub$winner == t | sub$loser == t, ]
      if (!nrow(g)) return(NA_real_)
      sum(g$winner == t) / nrow(g)
    })
  }
}

# ── NHL-specific criteria (points system) ───────────────────────
crit_nhl_rw <- function(records) function(teams) sapply(teams, function(t) if (t %in% rownames(records)) records[t, "reg_wins"] else NA_real_)
crit_nhl_row <- function(records) function(teams) sapply(teams, function(t) if (t %in% rownames(records)) records[t, "reg_wins"] + records[t, "ot_wins"] else NA_real_)
crit_nhl_wins <- function(records) function(teams) sapply(teams, function(t) if (t %in% rownames(records)) records[t, "wins"] else NA_real_)
crit_goal_diff <- function(records) function(teams) sapply(teams, function(t) if (t %in% rownames(records)) records[t, "pf"] - records[t, "pa"] else NA_real_)
crit_goals_for <- function(records) function(teams) sapply(teams, function(t) if (t %in% rownames(records)) records[t, "pf"] else NA_real_)

# ================================================================
# ── Per-sport official tiebreaker criteria lists ────────────────
# Each builder takes the season's game log + computed records (+ team ->
# division map, + full-league win% where needed) and returns the ordered
# list of criteria for resolve_tiebreak_order(). Where a league's real
# procedure branches (NFL: division ties vs wildcard ties use different
# orders), two builders are provided. Steps beyond what's listed here are
# either circular (NBA's "vs playoff-eligible teams"), require data this
# site doesn't have (play-by-play-derived net touchdowns, exact "last N
# meetings" sequencing), or are literal coin-tosses/draws — those residual
# ties fall through to the Elo-rank fallback baked into
# resolve_tiebreak_order() itself. See the module HONESTY NOTE up top.
# ================================================================

# NBA — head-to-head, division record, conference record, point diff.
# (Official rule also has "win% vs playoff-eligible teams in conference"
# between conference record and point differential; that step is circular
# — who's "playoff-eligible" depends on the very standings being computed
# — so it's skipped and callers fall to point diff, then Elo.)
nba_criteria <- function(games, records, team_div) {
  list(
    crit_head_to_head(games),
    crit_group_record(games, team_div, NULL),
    crit_group_record(games, sapply(names(team_div), function(t) div_conf("NBA", team_div[[t]])) |>
                         setNames(names(team_div)), NULL),
    crit_point_diff(records)
  )
}

# NHL — current (2021+) rule: standings are sorted by points percentage
# (handled by the caller's ordering, not a "criterion" here since it's the
# primary sort key), then ties break by: regulation+OT wins (ROW), then
# head-to-head points earned, then goal differential.
nhl_criteria <- function(games, records) {
  list(
    crit_nhl_row(records),
    crit_head_to_head(games),
    crit_goal_diff(records)
  )
}

# MLB — head-to-head win%, then division record (for teams in the same
# division), then the "second half" split (approximated — see
# crit_second_half's own comment), then run differential.
mlb_criteria <- function(games, records, team_div) {
  list(
    crit_head_to_head(games),
    crit_group_record(games, team_div, NULL),
    crit_second_half(games),
    crit_point_diff(records)
  )
}

# NFL — division ties: head-to-head, division record, common games (min 4),
# conference record, strength of victory, strength of schedule, point diff.
nfl_division_criteria <- function(games, records, team_div, all_win_pct) {
  team_conf <- sapply(names(team_div), function(t) div_conf("NFL", team_div[[t]])) |> setNames(names(team_div))
  list(
    crit_head_to_head(games),
    crit_group_record(games, team_div, NULL),
    crit_common_games(games, min_games = 4),
    crit_group_record(games, team_conf, NULL),
    crit_strength_of_victory(games, all_win_pct),
    crit_strength_of_schedule(games, all_win_pct),
    crit_point_diff(records)
  )
}

# NFL — wildcard ties: same as above but division record is skipped (the
# official rule only compares division record when every tied team shares
# a division, which isn't true of a wildcard tie by definition).
nfl_wildcard_criteria <- function(games, records, team_div, all_win_pct) {
  team_conf <- sapply(names(team_div), function(t) div_conf("NFL", team_div[[t]])) |> setNames(names(team_div))
  list(
    crit_head_to_head(games),
    crit_group_record(games, team_conf, NULL),
    crit_common_games(games, min_games = 4),
    crit_strength_of_victory(games, all_win_pct),
    crit_strength_of_schedule(games, all_win_pct),
    crit_point_diff(records)
  )
}

# ================================================================
# ── Playoff-field / seeding construction ─────────────────────────
# Each seed_<sport>() takes records (from build_records), a team -> division
# map, the season's game log, and an elo_lookup (named vector, team ->
# rating, for the tiebreak resolver's final fallback), and returns a data
# frame: team, conference, division, seed (integer or NA), status (one of
# "clinched"/"contending"/"eliminated"-equivalent labels appropriate to
# each sport — this engine doesn't know which teams are mathematically
# eliminated, only "if the field were set today", so status here just
# means "in the current field" vs "on the outside looking in"), and a
# `note` field. All are snapshots of "if the season ended today" — real
# playoff seeding is only final once the regular season actually ends.
# ================================================================

.rank_group <- function(teams, records, criteria, elo_lookup, primary = c("win_pct", "points_pct")) {
  # Order a group of teams by primary record stat (desc), resolving exact
  # ties via the supplied criteria cascade.
  primary <- primary[1]
  if (!primary %in% names(records)) primary <- "win_pct"
  vals <- records[teams, primary]
  ord <- character(0)
  for (v in sort(unique(vals), decreasing = TRUE)) {
    grp <- teams[vals == v]
    if (length(grp) > 1) grp <- resolve_tiebreak_order(grp, criteria, elo_lookup)
    ord <- c(ord, grp)
  }
  ord
}

seed_nba <- function(records, team_div, games, elo_lookup) {
  team_conf <- sapply(names(team_div), function(t) div_conf("NBA", team_div[[t]])) |> setNames(names(team_div))
  crit <- nba_criteria(games, records, team_div)
  out <- list()
  for (conf in c("Eastern", "Western")) {
    teams <- names(team_conf)[!is.na(team_conf) & team_conf == conf]
    teams <- intersect(teams, rownames(records))
    if (!length(teams)) next
    ord <- .rank_group(teams, records, crit, elo_lookup)
    for (i in seq_along(ord)) {
      # Only seeds 1-6 are a fixed numeric seed. 7-10 make the play-in
      # tournament, but which of them ends up the 7/8/9/10 seed depends on
      # actual play-in games this engine doesn't simulate — see `note`.
      seed <- if (i <= 6) i else NA_integer_
      status <- if (i <= 6) "clinched_top6" else if (i <= 10) "play_in" else "outside"
      out[[length(out) + 1]] <- data.frame(
        team = ord[i], conference = conf, division = team_div[[ord[i]]],
        seed = seed, status = status,
        note = if (i <= 6) "Top 6 — direct playoff seed"
               else if (i <= 10) "Play-in tournament (seeds 7-10); exact 7/8/9/10 slot depends on play-in games, not modeled here"
               else NA_character_,
        stringsAsFactors = FALSE
      )
    }
  }
  do.call(rbind, out)
}

seed_nhl <- function(records, team_div, games, elo_lookup) {
  team_conf <- sapply(names(team_div), function(t) div_conf("NHL", team_div[[t]])) |> setNames(names(team_div))
  crit <- nhl_criteria(games, records)
  out <- list()
  for (conf in c("Eastern", "Western")) {
    divs <- names(DIV_TO_CONF$NHL)[DIV_TO_CONF$NHL == conf]
    div_top3 <- character(0)
    for (dv in divs) {
      teams <- names(team_div)[!is.na(team_div) & team_div == dv]
      teams <- intersect(teams, rownames(records))
      if (!length(teams)) next
      ord <- .rank_group(teams, records, crit, elo_lookup, primary = "points_pct")
      top3 <- head(ord, 3)
      for (i in seq_along(top3)) {
        out[[length(out) + 1]] <- data.frame(
          team = top3[i], conference = conf, division = dv, seed = i,
          status = "division_top3", note = "Top 3 in division",
          stringsAsFactors = FALSE
        )
      }
      div_top3 <- c(div_top3, top3)
    }
    # Wildcards: everyone else in the conference, ranked conference-wide.
    conf_teams <- intersect(names(team_conf)[!is.na(team_conf) & team_conf == conf], rownames(records))
    wc_pool <- setdiff(conf_teams, div_top3)
    if (length(wc_pool)) {
      wc_ord <- .rank_group(wc_pool, records, crit, elo_lookup, primary = "points_pct")
      for (i in seq_along(wc_ord)) {
        seed <- if (i <= 2) i + 3L else NA_integer_
        status <- if (i <= 2) "wildcard" else "outside"
        out[[length(out) + 1]] <- data.frame(
          team = wc_ord[i], conference = conf, division = team_div[[wc_ord[i]]],
          seed = seed, status = status,
          note = if (i <= 2) "Conference wildcard" else NA_character_,
          stringsAsFactors = FALSE
        )
      }
    }
  }
  do.call(rbind, out)
}

seed_mlb <- function(records, team_div, games, elo_lookup) {
  team_lg <- sapply(names(team_div), function(t) div_conf("MLB", team_div[[t]])) |> setNames(names(team_div))
  crit <- mlb_criteria(games, records, team_div)
  out <- list()
  for (lg in c("AL", "NL")) {
    divs <- unique(team_div[!is.na(team_lg) & team_lg == lg])
    winners <- character(0)
    for (dv in divs) {
      teams <- names(team_div)[!is.na(team_div) & team_div == dv]
      teams <- intersect(teams, rownames(records))
      if (!length(teams)) next
      ord <- .rank_group(teams, records, crit, elo_lookup)
      winners <- c(winners, ord[1])
    }
    winners_ord <- .rank_group(winners, records, crit, elo_lookup)
    for (i in seq_along(winners_ord)) {
      out[[length(out) + 1]] <- data.frame(
        team = winners_ord[i], conference = lg, division = team_div[[winners_ord[i]]],
        seed = i, status = "division_winner",
        note = if (i <= 2) "Division winner — first-round bye" else "Division winner",
        stringsAsFactors = FALSE
      )
    }
    lg_teams <- intersect(names(team_lg)[!is.na(team_lg) & team_lg == lg], rownames(records))
    wc_pool <- setdiff(lg_teams, winners_ord)
    if (length(wc_pool)) {
      wc_ord <- .rank_group(wc_pool, records, crit, elo_lookup)
      for (i in seq_along(wc_ord)) {
        seed <- if (i <= 3) i + 3L else NA_integer_
        status <- if (i <= 3) "wildcard" else "outside"
        out[[length(out) + 1]] <- data.frame(
          team = wc_ord[i], conference = lg, division = team_div[[wc_ord[i]]],
          seed = seed, status = status,
          note = if (i <= 3) "Wildcard" else NA_character_,
          stringsAsFactors = FALSE
        )
      }
    }
  }
  do.call(rbind, out)
}

seed_nfl <- function(records, team_div, games, elo_lookup) {
  team_conf <- sapply(names(team_div), function(t) div_conf("NFL", team_div[[t]])) |> setNames(names(team_div))
  all_win_pct <- setNames(records$win_pct, rownames(records))
  div_crit <- nfl_division_criteria(games, records, team_div, all_win_pct)
  wc_crit  <- nfl_wildcard_criteria(games, records, team_div, all_win_pct)
  out <- list()
  for (conf in c("AFC", "NFC")) {
    divs <- unique(team_div[!is.na(team_conf) & team_conf == conf])
    winners <- character(0)
    for (dv in divs) {
      teams <- names(team_div)[!is.na(team_div) & team_div == dv]
      teams <- intersect(teams, rownames(records))
      if (!length(teams)) next
      ord <- .rank_group(teams, records, div_crit, elo_lookup)
      winners <- c(winners, ord[1])
    }
    winners_ord <- .rank_group(winners, records, div_crit, elo_lookup)
    for (i in seq_along(winners_ord)) {
      out[[length(out) + 1]] <- data.frame(
        team = winners_ord[i], conference = conf, division = team_div[[winners_ord[i]]],
        seed = i, status = "division_winner", note = "Division winner",
        stringsAsFactors = FALSE
      )
    }
    conf_teams <- intersect(names(team_conf)[!is.na(team_conf) & team_conf == conf], rownames(records))
    wc_pool <- setdiff(conf_teams, winners_ord)
    if (length(wc_pool)) {
      wc_ord <- .rank_group(wc_pool, records, wc_crit, elo_lookup)
      for (i in seq_along(wc_ord)) {
        seed <- if (i <= 3) i + 4L else NA_integer_
        status <- if (i <= 3) "wildcard" else "outside"
        out[[length(out) + 1]] <- data.frame(
          team = wc_ord[i], conference = conf, division = team_div[[wc_ord[i]]],
          seed = seed, status = status,
          note = if (i <= 3) "Wildcard" else NA_character_,
          stringsAsFactors = FALSE
        )
      }
    }
  }
  do.call(rbind, out)
}

message("[standings_engine] loaded.")
