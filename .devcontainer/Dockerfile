FROM mcr.microsoft.com/playwright:v1.61.0-noble

RUN apt-get update && apt-get -y install git curl bash imagemagick inotify-tools ripgrep less tzdata xvfb pngcrush
RUN ln -sf /usr/share/zoneinfo/hostlocaltime /etc/localtime

RUN curl -L https://github.com/jj-vcs/jj/releases/download/v0.43.0/jj-v0.43.0-x86_64-unknown-linux-musl.tar.gz -o /tmp/jj.tar.gz \
  && echo "59e5588583ac82b623239929368c65b90735931c0f26b5a16c1f04d5bb97643d  /tmp/jj.tar.gz" | sha256sum -c \
  && tar xz -C /usr/local/bin ./jj -f /tmp/jj.tar.gz \
  && rm /tmp/jj.tar.gz

USER ubuntu
WORKDIR /home/ubuntu

RUN mkdir -p /home/ubuntu/persistent-config
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/home/ubuntu/persistent-config/.bash_history" \
  && echo "$SNIPPET" >> "/home/ubuntu/.bashrc"

RUN wget -qO- https://get.pnpm.io/install.sh | ENV="/home/ubuntu/.bashrc" SHELL="$(which bash)" bash -

WORKDIR /workspaces/jjx

ENV EDITOR='code --wait'
