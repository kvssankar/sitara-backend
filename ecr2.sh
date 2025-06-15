#!/bin/bash

export AWS_PROFILE=buildiwthgenai

aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 895656015678.dkr.ecr.us-west-2.amazonaws.com
docker build -t hb .
docker tag hb:latest 895656015678.dkr.ecr.us-west-2.amazonaws.com/buildwithgenai:latest
docker push 895656015678.dkr.ecr.us-west-2.amazonaws.com/buildwithgenai:latest
git add .
git commit -m "commit from script"
git push