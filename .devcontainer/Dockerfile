FROM mcr.microsoft.com/playwright:v1.61.0-noble

RUN apt-get update && apt-get -y install git curl bash imagemagick inotify-tools ripgrep less tzdata xvfb pngcrush fonts-ubuntu fonts-dejavu-core fonts-dejavu-mono
RUN ln -sf /usr/share/zoneinfo/hostlocaltime /etc/localtime

# Match a native Ubuntu desktop's font resolution so screenshots render like native VS Code.
# Chromium resolves system-ui/monospace through fontconfig's generic defaults, which on an
# Ubuntu desktop pick DejaVu (Noto Sans is preferred first but only when installed). Without
# this pin, the container falls back to Nimbus Sans, whose metrics misalign UI text.
RUN printf '%s\n' \
  '<?xml version="1.0"?>' \
  '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
  '<fontconfig>' \
  '  <match target="pattern">' \
  '    <test qual="any" name="family"><string>sans-serif</string></test>' \
  '    <edit name="family" mode="prepend" binding="strong"><string>DejaVu Sans</string></edit>' \
  '  </match>' \
  '  <match target="pattern">' \
  '    <test qual="any" name="family"><string>system-ui</string></test>' \
  '    <edit name="family" mode="prepend" binding="strong"><string>DejaVu Sans</string></edit>' \
  '  </match>' \
  '  <match target="pattern">' \
  '    <test qual="any" name="family"><string>monospace</string></test>' \
  '    <edit name="family" mode="prepend" binding="strong"><string>DejaVu Sans Mono</string></edit>' \
  '  </match>' \
  '</fontconfig>' > /etc/fonts/local.conf

RUN curl -L https://github.com/jj-vcs/jj/releases/download/v0.44.0/jj-v0.44.0-x86_64-unknown-linux-musl.tar.gz -o /tmp/jj.tar.gz \
  && echo "0a07bab4641a55fd2bc2fd1563ba3a3f9a577584086ad74086a1c5b69b3ffce9  /tmp/jj.tar.gz" | sha256sum -c \
  && tar xz -C /usr/local/bin ./jj -f /tmp/jj.tar.gz \
  && rm /tmp/jj.tar.gz

# Older jj version for some integration tests.
RUN curl -L https://github.com/jj-vcs/jj/releases/download/v0.38.0/jj-v0.38.0-x86_64-unknown-linux-musl.tar.gz -o /tmp/jj-0.38.tar.gz \
  && echo "ed830d9a34a304f8ba258806b52521250a9fffded32ae89c4eb5285b33556a17  /tmp/jj-0.38.tar.gz" | sha256sum -c \
  && tar xz -C /tmp ./jj -f /tmp/jj-0.38.tar.gz \
  && mv /tmp/jj /usr/local/bin/jj-0.38 \
  && rm /tmp/jj-0.38.tar.gz

USER ubuntu
WORKDIR /home/ubuntu

RUN mkdir -p /home/ubuntu/persistent-config
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/home/ubuntu/persistent-config/.bash_history" \
  && echo "$SNIPPET" >> "/home/ubuntu/.bashrc"

RUN wget -qO- https://get.pnpm.io/install.sh | ENV="/home/ubuntu/.bashrc" SHELL="$(which bash)" bash -

WORKDIR /workspaces/jjx

ENV EDITOR='code --wait'
