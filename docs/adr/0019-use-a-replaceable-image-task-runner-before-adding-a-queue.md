# Use a replaceable image task runner before adding a queue

FluxArt V1 will introduce an Image Task Runner seam but will not require Redis or a dedicated queue worker at launch. The first implementation may execute from the Next.js server process, but the task lifecycle must be shaped so it can move later to BullMQ, a cloud task system, or a standalone Node worker without changing the product model.
