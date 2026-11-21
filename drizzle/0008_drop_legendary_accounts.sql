-- Epic is read from the Epic Games Launcher's cache now: accounts of the removed
-- Legendary provider (no stored secret) would only show an error. Their games stay.
DELETE FROM `accounts` WHERE `kind` = 'epic-legendary';
