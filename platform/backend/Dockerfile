FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Zig 0.16.0 from pre-downloaded tarball
COPY zig.tar.xz /tmp/zig.tar.xz
RUN tar -xJ -C /usr/local -f /tmp/zig.tar.xz \
    && ln -sf /usr/local/zig-x86_64-linux-0.16.0/zig /usr/local/bin/zig \
    && rm /tmp/zig.tar.xz \
    && zig version

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x entrypoint.sh

EXPOSE 8000

CMD ["./entrypoint.sh"]
