main() {
    echo "installing ffmpeg and npm"
    sudo apt install nodejs npm ffmpeg || return $?

    echo "installing dependencies"
    npm install || return $?
}

main || {
    code="$?";
    echo "failed to install dependencies";
    exit $code;
};
echo "insalled dependencies!"
