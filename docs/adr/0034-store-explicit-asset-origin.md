# Store explicit asset origin

FluxArt V1 will store an explicit Asset Origin on image assets instead of inferring uploaded assets from a missing task id. Generated and uploaded assets share the asset center, but they differ in prompt display, commercial authorization, task linkage, and future retention or filtering rules, so the origin should be a first-class field rather than an implicit database convention.
