# Vi Commands — The 90's OG Edition 🖥️

## Les mouvements de légende

- `gg` → aller tout en haut du fichier
- `G` → aller tout en bas
- `0` → début de ligne, `$` → fin de ligne
- `w` → sauter mot par mot, `b` → reculer mot par mot
- `%` → sauter entre parenthèses/accolades correspondantes (clutch pour le code)
- `*` → chercher le mot sous le curseur vers le bas, `#` → vers le haut

## Les kills qu'on oublie jamais

- `dd` → supprimer la ligne entière
- `D` → supprimer du curseur jusqu'à la fin de la ligne
- `dw` → supprimer un mot
- `cw` → supprimer le mot et passer en mode insertion (change word)
- `ci"` → supprimer tout entre les guillemets et éditer (change inside quotes)
- `yy` → copier la ligne, `p` → coller en dessous
- `xp` → swap deux caractères (genre corriger "teh" → "the")
- `J` → fusionner la ligne du dessous avec la courante

## Les power moves

- `.` → répéter la dernière action (le plus sous-estimé de tous)
- `u` → undo, `Ctrl+r` → redo
- `:%s/old/new/g` → find & replace dans tout le fichier
- `:!command` → exécuter une commande shell sans quitter vi
- `ZZ` → sauvegarder et quitter (plus rapide que `:wq`)
- `qa` ... `q` puis `@a` → enregistrer et rejouer une macro

## Le flex ultime des 90's

- `:wq!` quand on sait ce qu'on fait
- `:q!` quand on sait plus ce qu'on fait 😄

> Le `.` (dot repeat) c'est vraiment le game changer — les vrais l'utilisent en boucle.
