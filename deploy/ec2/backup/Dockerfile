FROM postgres:16-alpine

RUN apk add --no-cache aws-cli bash

COPY backup-postgres.sh /usr/local/bin/backup-postgres
RUN chmod +x /usr/local/bin/backup-postgres

ENTRYPOINT ["backup-postgres"]
