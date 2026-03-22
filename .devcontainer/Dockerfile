FROM mcr.microsoft.com/playwright:v1.56.0-noble

RUN apt-get update && apt-get -y install git curl bash inotify-tools ripgrep less tzdata xvfb xz-utils
RUN ln -sf /usr/share/zoneinfo/hostlocaltime /etc/localtime

ADD https://go.microsoft.com/fwlink/?LinkID=760868 /tmp/vscode.deb
RUN apt-get install -y /tmp/vscode.deb && apt-get install -f -y && rm /tmp/vscode.deb

ADD https://ziglang.org/download/0.14.1/zig-x86_64-linux-0.14.1.tar.xz /tmp/zig.tar.xz
RUN mkdir -p /opt/zig && tar -xf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 && rm /tmp/zig.tar.xz
ENV PATH=$PATH:/opt/zig

USER ubuntu
WORKDIR /home/ubuntu

RUN mkdir -p /home/ubuntu/persistent-config
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/home/ubuntu/persistent-config/.bash_history" \
  && echo "$SNIPPET" >> "/home/ubuntu/.bashrc"

WORKDIR /workspaces/jjx

ENV EDITOR='code --wait'
EXPOSE 8000
