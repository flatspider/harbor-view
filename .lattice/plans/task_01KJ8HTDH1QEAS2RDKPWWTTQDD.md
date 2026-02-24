# HAR-35: Fix ship info panel off-screen positioning after status panel layout change

Use harbor-scene relative click coordinates and clamp ShipInfoCard position to container bounds to prevent off-screen rendering after header/panel layout shifts.
