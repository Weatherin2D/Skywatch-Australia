"""Physical constants (SI unless noted). Pressure is hPa throughout the package."""
G = 9.80665            # m s-2
RD = 287.04749         # J kg-1 K-1, dry air
CPD = 1004.6662        # J kg-1 K-1, dry air at constant pressure
KAPPA = RD / CPD       # Rd/cp
EPS = 0.6219569        # Rd/Rv
T0 = 273.15            # K
LV0 = 2.501e6          # J kg-1, latent heat of vaporisation at 0 C
KAPPA_BOLTON = 0.2854  # exponent used inside Bolton (1980) theta-e formulae
