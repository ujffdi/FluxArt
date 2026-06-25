# Use sliding user sessions with absolute expiry

FluxArt V1 will use server-side User Sessions represented by httpOnly cookies. Sessions are valid for 30 days with sliding renewal on activity and a 90-day absolute maximum lifetime, balancing low-friction creative workflows with bounded account exposure.
