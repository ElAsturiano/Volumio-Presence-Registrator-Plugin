## Presence Registrator + SnapCast environment installation script
echo "Installing Presence Registrator + SnapCast environment and its dependencies..."
INSTALLING="/home/volumio/presence_registrator_environment.installing"

if [ ! -f $INSTALLING ]; then

	touch $INSTALLING
	
	echo "Updating system..."
	sudo apt-get update
	echo "Updated."

	echo "Fetching basic dependencies..."
	sudo apt-get install build-essential -y
	sudo apt-get install subversion -y
	echo "Fetched."
	
	echo "Downloading files from repository..."
	cd /home/volumio
	svn checkout https://github.com/ElAsturiano/Volumio-Presence-Registrator-Plugin/trunk/plugins
	echo "Downloaded."

	echo "Installing Presence Registrator Plugin..."
	cd /home/volumio/plugins/presence_registrator
	volumio plugin install
	echo "Installed."

	echo "Installing Snapcast Plugin..."
	cd /home/volumio/plugins/volumio-snapcast-plugin-master
	volumio plugin install
	echo "Installed."
	
	cd /home/volumio
	rm $INSTALLING

	echo "Presence Registrator + Snapcast environment succesfully installed!"
else
	echo "Presence Registrator + Snapcast environment installation already running! Not continuing..."
fi