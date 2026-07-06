# Protect model administration with an admin secret

FluxArt V1 will protect Model Administration with an authenticated user session plus a server-configured admin secret instead of adding a full role-based access control model. This keeps the lightweight operational page small while avoiding the unsafe default where any registered account can change the Active Image Model Configuration; a future multi-admin product can replace this boundary with user roles.
