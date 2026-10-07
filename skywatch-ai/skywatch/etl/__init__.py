"""Real-data ETL scaffolding for V1 training samples.

Bootstrap sources (public, no BARRA2/ERA5 required yet):
  - Teacher prior: Open-Meteo multi-model pressure-level forecast
  - Observations: UWYO radiosonde HTML/text soundings

Target output: samples that pass `skywatch.contract.validate_sample`.
"""
