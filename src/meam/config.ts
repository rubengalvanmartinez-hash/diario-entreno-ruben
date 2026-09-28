/**
 * MEAM — configuración versionada (port literal de CONFIG de meam_core.py, 2.3.0-rc).
 * Ninguna constante fuera de aquí. Toda cifra tiene su justificación en MEAM_v2_3_especificacion.md (§4).
 */
export const MEAM_CONFIG = {
  config_version: '2.3.1-rc',
  model_version: 'meam-ts-2.3.2',   // 2.3.2: confianza P14 sin doble penalización por ρ sin calibrar (capa de informe; el motor no cambia)
  // P0/P1 rendimiento
  e1rm_reps_min: 1, e1rm_reps_max: 12, e1rm_reps_max_isolation: 20, e1rm_rir_known_max: 3, rir_adjust_cap: 3,
  rep_bands: [[1, 5], [6, 8], [9, 12], [13, 20]] as ReadonlyArray<readonly [number, number]>,
  stratum_window: 4,
  interleave_window: 8, interleave_min: 3, interleave_min_switches: 3, stratum_shift_reps: 3,
  epley_k: 30.0,
  n_sets_top: 3,
  errata_log_dev: 0.22,
  working_set_load_ratio: 0.90,
  deload_infer_volume_ratio: 0.60, deload_infer_load_ratio: 0.90,
  hard_set_rir_max: 3,
  // P2 peso corporal
  bw_ref_window_days: 7, bw_ref_fallback_days: 21,
  // P4 tiempo
  gap_normal_window: 12, gap_normal_min_intervals: 3, gap_normal_default_days: 3.5,
  gap_interruption_days_min: 21, gap_interruption_factor: 3.0, gap_segment_reset_days: 42,
  post_interruption_exposures_for_D: 2, post_interruption_burn_in_weeks: 3.0,
  // P5/P6 pronóstico y escala
  M_min: 6, M_max: 12, W_err: 20, fc_min_train: 8, fc_over_res_default: 1.3,
  res_min_n: 6,
  prior_pseudo_n: 4, prior_pseudo_n_zero_at: 20,
  prior_min_n_err: 10,
  prior_default_log: { compound_free: 0.018, isolation_machine: 0.025, assisted: 0.025, weighted_bodyweight: 0.025 } as Record<string, number>,
  resolution_load_increment_kg: 2.5,
  resolution_window: 20, resolution_min_distinct: 3,
  resolution_floor_factor: 1.0,
  dedupe_same_day: true,
  nu_fraction: 0.6, nu_min: 3,
  tier_established: 8, tier_mature: 20,
  rho_min_n_err: 20, rho_clip: [0.0, 0.6] as readonly [number, number], rho_min_variants: 3, rho_default_uncalibrated: 0.3,
  ac_finite_sample: true,
  alpha_D: 0.05, alpha_D_one_sided: true, kappa: 1.0,
  median_ineff: 1.151,
  // P7 tendencia
  N_state: 32, N_state_min: 8, state_span_min_weeks: 6.0, state_span_max_weeks: 16.0,
  recent_half_fraction: 0.5, recent_half_min_n: 5,
  alpha_T: 0.02,
  long_channel: true, N_state_long: 52, state_span_max_weeks_long: 26.0, state_span_min_weeks_long: 18.0, N_state_min_long: 24,
  alpha_T_long: 0.01, long_rh_min_fraction: 0.5,
  min_effect_sigma: 1.0,
  T_cap: 10.0,
  tq_min_n: 8, tq_min_span_weeks: 8.0, tq_max_median_gap_days: 10.0, tq_max_gap_cv: 0.75,
  // P8 salida reciente
  n_recent: 3, n_recent_min: 2, recent_max_days: 21, n_base: 6, n_base_min: 4, base_max_days: 70,
  z_below_thr: -1.0, persistence_window: 5, persistence_min: 4, recent_below_margin_sigma: 0.5,
  // P9 agregación
  cluster_max_share: 0.60, concordance_min_3plus: 0.67, cluster_neutral_abs_T: 0.25, contradiction_abs_T: 0.5,
  cluster_corr_default: 0.5, cluster_corr_pseudo_n: 8, cluster_corr_min_pairs: 8, cluster_pair_window_weeks: 0.5,
  corroboration_corr_max: 0.5,
  // P10 adaptación
  T_enter: 1.0, T_stay: 0.5, recent_half_exit_snapshots: 2,
  regression_confirmations: 3, regression_min_new_exposures_between: 2,
  // P11 recuperación
  D_enter: -1.0, suspect_confirmations: 1,
  recover_margin_dct: 0.5, reduction_gap_factor: 2.0, reduction_gap_days_min: 7,
  reduction_lookback_days: 14, reduction_volume_ratio: 0.70, post_reduction_min_exposures: 2,
  recovery_exit_snapshots: 2, suspect_max_weeks: 6, alert_ttl_days: 14,
  noatr_max_weeks: 8, apoyada_max_weeks: 8,
  exclusion_max_weeks_52w: 10.0, exclusion_typical_episode_weeks: 4.0,
  context_percentile: 80, context_window_weeks: 12, context_pain_min: 2, volume_high_percentile: 70, volume_low_percentile: 40, volume_very_low_percentile: 25,
  no_improvement_exposures: 6,
  // calibración
  target_false_regression_per_variant_year: 0.10, target_false_progress_per_variant_year: 0.15,
} as const

export type MeamConfig = typeof MEAM_CONFIG
