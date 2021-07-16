$(document).ready(function() {
	$('.showmenu').on('click',  function(e) {
		e.preventDefault();
		$('.menu-list').toggleClass('active');
	});
});