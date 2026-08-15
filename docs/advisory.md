# Poultry Advisory Model

IQuila's advisory is an explainable trend forecast, not a disease diagnostic or treatment system. It compares the most recent 3-7 recorded days for a flock against the prior 3-7 days, forecasts the next two days from that trend, and flags material changes in mortality, feed, water, and eggs.

## Inputs

- Flock type, start date, initial count, and current count.
- Daily mortality, culls, feed, water, eggs, and weight when recorded.
- At least five distinct record dates. Fewer dates return an insufficient-data status.

## Recommendations

Alerts recommend operational checks only: bird observation, water/drinker function, feed access and quality, ventilation, heat conditions, lighting for layers, litter, biosecurity, and veterinary escalation for sudden or continuing mortality. The model does not diagnose illness, set medication, alter rations, or replace a veterinarian.

## Evidence Basis

The model uses flock-specific trend changes rather than universal production targets because breed, climate, housing, age, density, and feed formulation vary. Its recommended review areas reflect FAO guidance that production is affected by water, feed, temperature, lighting, housing, mortality, and disease control.

- FAO, *Small-Scale Poultry Production*, Chapter 1: https://www.fao.org/4/y4628e/y4628e03.htm
- FAO, *Small-Scale Poultry Production*, Chapter 2: https://www.fao.org/4/y4628e/y4628e04.htm

The FAO material notes that layers typically begin commercial production around 21 weeks, that heat can reduce feed intake and egg production, and that clean water, hygiene, housing, and disease control materially affect outcomes. IQuila does not convert those references into fixed clinical thresholds.
