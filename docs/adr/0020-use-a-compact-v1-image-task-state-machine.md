# Use a compact V1 image task state machine

FluxArt V1 will use a compact Image Task State Machine: queued, running, storing, reviewing, succeeded, failed, and refunded. More granular provider events can be captured in logs or task metadata, but the product state should stay small enough for UI, refunds, and asset creation to remain understandable.
