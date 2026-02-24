FROM node:25-bookworm

RUN apt-get update && apt-get -y install git curl bash ripgrep less tzdata
RUN ln -sf /usr/share/zoneinfo/hostlocaltime /etc/localtime

ADD https://go.microsoft.com/fwlink/?LinkID=760868 /tmp/vscode.deb
RUN apt-get install -y /tmp/vscode.deb && apt-get install -f -y && rm /tmp/vscode.deb

USER node
WORKDIR /home/node

RUN mkdir -p /home/node/persistent-config
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/home/node/persistent-config/.bash_history" \
  && echo "$SNIPPET" >> "/home/node/.bashrc"

WORKDIR /workspaces/jjk

ENV EDITOR='code --wait'
EXPOSE 8000
